import type { APIRoute } from 'astro';
import content from '../../data/site_content_skeleton.json';
import {
  getPhotoStatsMap,
  getValidTourPhotosMap,
  normalizePhotoPath,
  rankTourGallery,
  recordPhotoEvents,
  type IncomingPhotoEvent,
} from '../../lib/photoStats';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const tourId = url.searchParams.get('tour')?.trim();
    const stats = await getPhotoStatsMap();

    if (tourId) {
      const tour = (content.tours as any[]).find((t) => t.id === tourId);
      if (!tour) {
        return new Response(
          JSON.stringify({ success: false, error: 'Tour not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          tourId,
          ...rankTourGallery(tour, stats),
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          },
        }
      );
    }

    const overview = (content.tours as any[]).map((tour) => ({
      id: tour.id,
      title: tour.title,
      ...rankTourGallery(tour, stats),
    }));

    return new Response(
      JSON.stringify({ success: true, tours: overview }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (err: any) {
    console.error('GET /api/photo-stats error:', err);
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
    const rawEvents = Array.isArray(body?.events) ? body.events.slice(0, 50) : [];

    const validMap = getValidTourPhotosMap();
    const allowedPhotos = validMap[tourId];

    if (!allowedPhotos) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid tourId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const sanitizedEvents: IncomingPhotoEvent[] = [];
    for (const ev of rawEvents) {
      const normalized = normalizePhotoPath(String(ev?.photo || ''));
      if (!normalized || !allowedPhotos.has(normalized)) continue;
      sanitizedEvents.push({
        photo: normalized,
        thumbClick: ev?.thumbClick ? 1 : 0,
        lightboxOpen: ev?.lightboxOpen ? 1 : 0,
        dwellView: ev?.dwellView ? 1 : 0,
      });
    }

    if (sanitizedEvents.length === 0) {
      return new Response(
        JSON.stringify({ success: true, updated: 0, inserted: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await recordPhotoEvents(tourId, sanitizedEvents);
    return new Response(
      JSON.stringify({ success: true, ...result }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('POST /api/photo-stats error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err?.message || 'Failed to record stats' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
