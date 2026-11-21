import type { APIRoute } from 'astro';
import content from '../../data/site_content_skeleton.json';
import {
  getTourStatsMap,
  getValidTourIds,
  rankToursForCatalog,
  recordTourEvent,
} from '../../lib/tourStats';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const stats = await getTourStatsMap();
    const ranked = rankToursForCatalog(content.tours as any[], stats);

    const leaderboard = ranked.map((tour, index) => {
      const m = stats[tour.id] || {
        tourId: tour.id,
        views: 0,
        guideReferrals: 0,
        bookClicks: 0,
        score: 0,
        lastUpdated: '',
      };
      return {
        position: index + 1,
        id: tour.id,
        title: tour.title,
        views: m.views,
        guideReferrals: m.guideReferrals,
        bookClicks: m.bookClicks,
        score: m.score,
        lastUpdated: m.lastUpdated,
      };
    });

    return new Response(
      JSON.stringify({ success: true, tours: leaderboard }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (err: any) {
    console.error('GET /api/tour-stats error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const rawBody = await request.text();
    if (!rawBody) {
      return new Response(
        JSON.stringify({ success: false, error: 'Empty body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = JSON.parse(rawBody);
    const tourId = String(body?.tourId || '').trim();
    const validIds = getValidTourIds();

    if (!tourId || !validIds.has(tourId)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid tourId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await recordTourEvent({
      tourId,
      view: body?.view ? 1 : 0,
      bookClick: body?.bookClick ? 1 : 0,
      fromGuide: Boolean(body?.fromGuide),
    });

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('POST /api/tour-stats error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Failed to record tour event' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
