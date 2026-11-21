import { google } from "googleapis";
import { randomUUID } from "crypto";
import { validateCouponCode } from "../../lib/coupons";

export async function POST({ request }) {
    try {
        const body = await request.json();

        // --------------------------------
        // BOOKING REFERENCE
        // --------------------------------

        const bookingReference =
            `CCT-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomUUID().slice(0, 6).toUpperCase()}`;

        // --------------------------------
        // GOOGLE SHEETS AUTHENTICATION
        // --------------------------------

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY
                    .replace(/\\n/g, "\n")
                    .replace(/^"|"$/g, ""),
            },
            scopes: [
                "https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/calendar",
            ],
        });

        const sheets = google.sheets({
            version: "v4",
            auth,
        });

        const calendar = google.calendar({
    version: "v3",
    auth,
});

        
// --------------------------------
// GET TOUR INFO
// --------------------------------

// Fallback dictionary in case Google Sheet TOUR INFO isn't yet updated or network blips
const FALLBACK_TOUR_DEFAULTS = {
    "pance-waterfalls-tour": { duration: "04:00:00", meeting: "Pickup anywhere within urban Cali" },
    "waterfalls": { duration: "04:00:00", meeting: "Pickup anywhere within urban Cali" },
    "cali-salsa-tour": { duration: "04:00:00", meeting: "Pickup anywhere within urban Cali" },
    "salsa-tour": { duration: "04:00:00", meeting: "Pickup anywhere within urban Cali" },
    "km18-cloud-forest-tour": { duration: "04:00:00", meeting: "Pickup anywhere within urban Cali" },
    "hummingbirds": { duration: "04:00:00", meeting: "Pickup anywhere within urban Cali" },
    "cali-market-fruit-tour": { duration: "03:00:00", meeting: "Galería Alameda main entrance or urban Cali pickup" },
    "market-tour": { duration: "03:00:00", meeting: "Galería Alameda main entrance or urban Cali pickup" },
    "colombian-coffee-tasting-cali": { duration: "02:30:00", meeting: "San Antonio neighborhood or urban Cali pickup" },
    "coffee-tasting": { duration: "02:30:00", meeting: "San Antonio neighborhood or urban Cali pickup" },
    "cali-street-food-tour": { duration: "03:00:00", meeting: "San Antonio historic area or urban Cali pickup" },
    "street-food": { duration: "03:00:00", meeting: "San Antonio historic area or urban Cali pickup" },
    "coffee-farm-day-trip": { duration: "06:00:00", meeting: "Pickup anywhere within urban Cali" },
    "coffee-farm": { duration: "06:00:00", meeting: "Pickup anywhere within urban Cali" },
    "chocolate-farm-tour": { duration: "05:00:00", meeting: "Pickup anywhere within urban Cali" },
    "chocotour": { duration: "05:00:00", meeting: "Pickup anywhere within urban Cali" },
    "cristo-rey-city-tour": { duration: "04:00:00", meeting: "Pickup anywhere within urban Cali" },
    "cristo-rey": { duration: "04:00:00", meeting: "Pickup anywhere within urban Cali" },
    "pacific-whale-watching-tour": { duration: "12:00:00", meeting: "Pickup anywhere within urban Cali" },
    "whale-watching": { duration: "12:00:00", meeting: "Pickup anywhere within urban Cali" },
    "san-cipriano-river-tubing": { duration: "09:30:00", meeting: "Pickup anywhere within urban Cali" }
};

let durationHours = "";
let meetingPoint = "";

try {
    // The tab has been called both "TOUR_INFO" and "TOUR INFO"; try both.
    let tourInfoRows = [];
    for (const tabName of ["TOUR_INFO", "TOUR INFO"]) {
        try {
            const tourInfoResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.GOOGLE_SHEET_ID,
                range: `${tabName}!A:C`,
            });
            tourInfoRows = tourInfoResponse.data.values || [];
            if (tourInfoRows.length) break;
        } catch (tabErr) {
            console.warn(`Tab "${tabName}" not readable:`, tabErr.message);
        }
    }

    // Match either by exact tour_id (new or old slug) or by title search
    const tourInfo = tourInfoRows.find(row => {
        if (!row || !row[0]) return false;
        const cell = String(row[0]).trim().toLowerCase();
        const incomingId = String(body.tour_id || "").trim().toLowerCase();
        const incomingTitle = String(body.tour || "").trim().toLowerCase();
        return cell === incomingId || incomingTitle.includes(cell) || cell.includes(incomingId);
    });

    if (tourInfo) {
        durationHours = tourInfo[1] || "";
        meetingPoint = tourInfo[2] || "";
    }
} catch (infoErr) {
    console.warn("Could not fetch TOUR INFO from sheet, will use fallbacks:", infoErr.message);
}

// Apply fallbacks if sheet did not return data
const fallback = FALLBACK_TOUR_DEFAULTS[body.tour_id] || { duration: "04:00:00", meeting: "Pickup anywhere within urban Cali" };
if (!durationHours) durationHours = fallback.duration;
if (!meetingPoint) meetingPoint = fallback.meeting;

console.log("Tour info:", {
    tour_id: body.tour_id,
    duration_hours: durationHours,
    meeting_point: meetingPoint
});

        // --------------------------------
        // VALIDATE OPTIONAL PARTNER COUPON (Server-Side)
        // --------------------------------
        let appliedCouponCode = "";
        let appliedCouponPercent = 0;
        let appliedPartnerName = "";

        if (body.coupon_code && String(body.coupon_code).trim()) {
            try {
                const couponResult = await validateCouponCode(String(body.coupon_code));
                if (couponResult.valid) {
                    appliedCouponCode = couponResult.code || "";
                    appliedCouponPercent = couponResult.discountPercent || 0;
                    appliedPartnerName = couponResult.partnerName || "";
                }
            } catch (couponErr) {
                console.warn("Coupon re-validation skipped:", couponErr?.message || couponErr);
            }
        }

        // Compute verified total if base_total is supplied; cumulative with 10% Cash discount
        const parsedBaseTotal = Number(body.base_total || 0);
        let verifiedTotal = Number(body.total || 0);
        if (parsedBaseTotal > 0) {
            const afterCoupon = appliedCouponPercent > 0
                ? Math.round(parsedBaseTotal * (1 - appliedCouponPercent / 100))
                : parsedBaseTotal;
            verifiedTotal = body.payment_status === "Cash"
                ? Math.round(afterCoupon * 0.90)
                : afterCoupon;
        }

        // --------------------------------
        // SAVE BOOKING TO GOOGLE SHEETS
        // --------------------------------

        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: "Sheet1!A:O",
            valueInputOption: "USER_ENTERED",
            insertDataOption: "INSERT_ROWS",
            requestBody: {
                values: [[
                    new Date(),
                    body.date || "",
                    body.tour || "",
                    body.time || "",
                    body.guests || "",
                    body.name || "",
                    body.email || "",
                    body.phone || "",
                    verifiedTotal || "",
                    bookingReference,
                    body.payment_status || "Pending",
                    body.bold_transaction_id || "",
                    appliedCouponCode,
                    appliedCouponPercent ? `${appliedCouponPercent}%` : "",
                    appliedPartnerName,
                ]],
            },
        });

       // --------------------------------
// WHATSAPP MESSAGE
// --------------------------------

const whatsappNumber = String(body.phone || "")
    .replace(/\D/g, "");

const guestName = body.name || "there";
const tourName = body.tour || "";
const tourDate = body.date || "";
const tourTime = body.time || "";
const guests = Number(body.guests || 1);

const whatsappMessage = `Hello ${guestName}! 👋

Thank you for booking with Cali Cultural Tours! 🇨🇴

Your reservation is confirmed:

${tourName}

📅 Date: ${tourDate}
🕐 Start time: ${tourTime}
⏱️ Duration: ${durationHours}
👥 ${guests} ${guests === 1 ? "guest" : "guests"}

📍 Meeting point:
${meetingPoint}

Booking reference: ${bookingReference}

If you have any questions or need to contact us before the tour, just let us know here.

Thank you for choosing Cali Cultural Tours!

See you soon! 😊`;

const whatsappUrl = whatsappNumber
    ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`
    : "";

        // --------------------------------
        // INTERNAL EMAIL
        // --------------------------------

        const whatsappButton = whatsappUrl
            ? `
                <div style="margin: 30px 0;">
                    <a
                        href="${whatsappUrl}"
                        style="
                            display: inline-block;
                            background: #25D366;
                            color: white;
                            text-decoration: none;
                            padding: 14px 22px;
                            border-radius: 8px;
                            font-weight: bold;
                        "
                    >
                        💬 Contact Guest on WhatsApp
                    </a>
                </div>
            `
            : `
                <p style="margin: 30px 0; color: #999;">
                    ⚠️ No WhatsApp number was provided for this booking.
                </p>
            `;

        const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; color: #222;">

                <h2 style="margin-bottom: 4px;">
                    🔔 New Booking
                </h2>

                <p style="color: #666; margin-top: 0;">
                    Booking reference:
                    <strong>${bookingReference}</strong>
                </p>

                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">

                <h3>${tourName}</h3>

                <p>📅 <strong>Date:</strong> ${tourDate}</p>
                <p>🕐 <strong>Start time:</strong> ${tourTime}</p>
                <p>👥 <strong>Guests:</strong> ${guests}</p>

                <h3>Guest</h3>

                <p>
                    <strong>${guestName}</strong><br>
                    ${body.email || ""}<br>
                    ${body.phone || ""}
                </p>

                <h3>Total</h3>

                <p style="font-size: 20px;">
                    <strong>${Number(verifiedTotal || 0).toLocaleString("en-US")} COP</strong>
                </p>

                ${appliedCouponCode ? `
                <p style="color: #059669;">
                    🏷️ <strong>Partner Coupon:</strong> ${appliedCouponCode} (${appliedCouponPercent}% off${appliedPartnerName ? ` · ${appliedPartnerName}` : ""})
                </p>
                ` : ""}

                <p>
                    <strong>Payment status:</strong>
                    ${body.payment_status || "Pending"}
                </p>

                ${whatsappButton}

                <p style="font-size: 12px; color: #999;">
                    Cali Cultural Tours booking system
                </p>

            </div>
        `;

        // --------------------------------
        // SEND EMAIL VIA RESEND
        // --------------------------------

        const resendResponse = await fetch(
            "https://api.resend.com/emails",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    from: "Cali Cultural Tours <bookings@caliculturaltours.com>",
                    to: ["info.caliculturaltours@gmail.com"],
                    subject: `🔔 New Booking — ${bookingReference}`,
                    html: emailHtml,
                }),
            }
        );

        const resendData = await resendResponse.json();

        // Email failure should NOT invalidate the booking
        if (!resendResponse.ok) {
            console.error("Resend error:", resendData);
        }

        // --------------------------------
// CUSTOMER CONFIRMATION EMAIL
// --------------------------------

const customerEmailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; color: #222;">

        <h2 style="margin-bottom: 4px;">
            Your reservation is confirmed! 🎉
        </h2>

        <p style="color: #666; margin-top: 0;">
            Thank you for choosing Cali Cultural Tours.
        </p>

        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">

        <h3>${tourName}</h3>

        <p>📅 <strong>Date:</strong> ${tourDate}</p>

        <p>🕐 <strong>Start time:</strong> ${tourTime}</p>

        <p>⏱️ <strong>Duration:</strong> ${durationHours}</p>

        <p>👥 <strong>Guests:</strong> ${guests}</p>

        <p>
    📍 <strong>Meeting point:</strong><br>
    ${meetingPoint}
</p>

${whatsappNumber ? `
    <div style="margin: 22px 0 28px 0;">
        <a
            href="${whatsappUrl}"
            style="
                display: inline-block;
                background: #25D366;
                color: white;
                text-decoration: none;
                padding: 14px 22px;
                border-radius: 8px;
                font-weight: bold;
                font-size: 15px;
            "
        >
            💬 Message us on WhatsApp
        </a>
    </div>
` : ""}

<hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">

        <p>
            <strong>Booking reference:</strong><br>
            ${bookingReference}
        </p>

        <p>
            <strong>Total:</strong><br>
            ${Number(verifiedTotal || 0).toLocaleString("en-US")} COP
        </p>

        ${appliedCouponCode ? `
        <p style="color: #059669;">
            <strong>Promo code applied:</strong><br>
            ${appliedCouponCode} (${appliedCouponPercent}% discount)
        </p>
        ` : ""}

        <p>
            <strong>Payment:</strong><br>
            ${body.payment_status === "Cash"
                ? (appliedCouponCode
                    ? `Cash payment (10% cash discount stacked with ${appliedCouponCode})`
                    : "Cash payment — 10% discount applied")
                : "Online payment"}
        </p>

        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">

        <p>
            If you need to make any changes to your reservation,
            simply reply to this email and we'll be happy to help.
        </p>

        <p>
            Thank you again for booking with us!
        </p>

        <p>
            See you soon! 😊
        </p>

        <p style="font-size: 12px; color: #999; margin-top: 30px;">
            Cali Cultural Tours<br>
            Cali, Colombia
        </p>

    </div>
`;

const customerEmailResponse = await fetch(
    "https://api.resend.com/emails",
    {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from: "Cali Cultural Tours <bookings@caliculturaltours.com>",
            to: [body.email],
            reply_to: "info.caliculturaltours@gmail.com",
            subject: `Your reservation is confirmed — ${bookingReference}`,
            html: customerEmailHtml,
        }),
    }
);

const customerEmailData = await customerEmailResponse.json();

if (!customerEmailResponse.ok) {
    console.error("Customer email error:", customerEmailData);
}

// --------------------------------
// GOOGLE CALENDAR EVENT
// --------------------------------

let calendarEventCreated = false;
let calendarErrorMessage = "";
let calendarErrorCode = "";

const CALENDAR_ID =
    process.env.GOOGLE_CALENDAR_ID ||
    "065ab151764dd23fe55535b74252ec1b553a43c9918a47d7957e9db771a96d18@group.calendar.google.com";

try {
    // ---- Parse start time ("06:00 AM", "6:00 PM" or 24h "18:00") ----
    const timeMatch = String(tourTime).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!timeMatch) {
        throw new Error(`Invalid tour time: "${tourTime}"`);
    }

    let hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const period = (timeMatch[3] || "").toUpperCase();

    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tourDate))) {
        throw new Error(`Invalid tour date: "${tourDate}"`);
    }

    // ---- Parse duration: "4:00:00", "04:00", "4 hours", "3.5" ... ----
    let durationH = 4;
    let durationM = 0;

    const timeParts = String(durationHours).match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (timeParts) {
        durationH = Number(timeParts[1]);
        durationM = Number(timeParts[2]);
    } else {
        const hoursNumber = parseFloat(String(durationHours).replace(/[^0-9.]/g, ""));
        if (!isNaN(hoursNumber) && hoursNumber > 0) {
            durationH = Math.floor(hoursNumber);
            durationM = Math.round((hoursNumber - durationH) * 60);
        }
    }

    // ---- Start / end in America/Bogota (UTC-5, no daylight saving) ----
    const [year, month, day] = String(tourDate).split("-").map(Number);
    const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

    const startUtcMs = Date.UTC(year, month - 1, day, hours, minutes) + BOGOTA_OFFSET_MS;
    const endUtcMs = startUtcMs + (durationH * 60 + durationM) * 60 * 1000;

    // Wall-clock time in Bogota, e.g. "2026-11-20T09:30:00"
    const toBogotaLocal = (ms) => new Date(ms - BOGOTA_OFFSET_MS).toISOString().slice(0, 19);

    const startDateTime = toBogotaLocal(startUtcMs);
    const endDateTime = toBogotaLocal(endUtcMs);

    const durationLabel = `${durationH}h${durationM ? ` ${durationM}m` : ""}`;

    const calendarDescription = `
Booking reference: ${bookingReference}
Source: Direct booking (caliculturaltours.com)

Guest: ${guestName}
Guests: ${guests}
Email: ${body.email || ""}
WhatsApp: ${body.phone || ""}

Tour: ${tourName}
Duration: ${durationLabel}
Payment: ${body.payment_status || "Pending"}
Total: ${Number(verifiedTotal || 0).toLocaleString("en-US")} COP${appliedCouponCode ? `\nPartner coupon: ${appliedCouponCode} (${appliedCouponPercent}% off${appliedPartnerName ? ` · ${appliedPartnerName}` : ""})` : ""}

Meeting point:
${meetingPoint}
`.trim();

    const eventBody = {
        summary: `${tourName} — ${guestName} (${guests} pax)`,
        location: meetingPoint,
        description: calendarDescription,
        start: { dateTime: startDateTime, timeZone: "America/Bogota" },
        end: { dateTime: endDateTime, timeZone: "America/Bogota" },
        extendedProperties: { private: { bookingReference } },
    };

    // ---- Insert, retrying only transient failures (network / 429 / 5xx) ----
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            await calendar.events.insert({ calendarId: CALENDAR_ID, requestBody: eventBody });
            lastError = null;
            break;
        } catch (insertError) {
            lastError = insertError;
            const status = Number(insertError?.code || insertError?.response?.status || 0);
            const transient = !status || status === 429 || status >= 500;
            if (!transient || attempt === 3) break;
            await new Promise((r) => setTimeout(r, 400 * attempt));
        }
    }
    if (lastError) throw lastError;

    calendarEventCreated = true;

    console.log("Calendar event created:", {
        booking_reference: bookingReference,
        start: startDateTime,
        end: endDateTime,
    });

} catch (calendarError) {

    // Calendar failure must NOT invalidate the booking, but it must NOT be silent either.
    calendarErrorCode = String(calendarError?.code || calendarError?.response?.status || "");
    calendarErrorMessage =
        calendarError?.response?.data?.error?.message ||
        calendarError?.message ||
        String(calendarError);
    console.error("Google Calendar error:", calendarErrorCode, calendarErrorMessage);
}

// If the event could not be created, alert the owner by email so it can be added manually.
if (!calendarEventCreated) {
    try {
        const esc = (v) =>
            String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        const permissionHint =
            ["403", "404"].includes(calendarErrorCode)
                ? `<p><strong>Most likely cause:</strong> the Google service account
                   (<code>${esc(process.env.GOOGLE_CLIENT_EMAIL || "unknown")}</code>) does not have
                   permission to edit this calendar. In Google Calendar &rarr; Settings for the calendar
                   &rarr; <em>Share with specific people</em> &rarr; add that email with
                   <strong>"Make changes to events"</strong>.</p>`
                : "";

        await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: "Cali Cultural Tours <bookings@caliculturaltours.com>",
                to: ["info.caliculturaltours@gmail.com"],
                subject: `⚠️ Calendar event NOT created — ${bookingReference}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; color: #222;">
                        <h2>⚠️ Calendar event was not created</h2>
                        <p>The booking <strong>was saved</strong> and the emails were sent, but the Google
                        Calendar event could not be created. Please add it manually.</p>
                        <p><strong>Reference:</strong> ${esc(bookingReference)}<br>
                           <strong>Tour:</strong> ${esc(tourName)}<br>
                           <strong>Date / time:</strong> ${esc(tourDate)} ${esc(tourTime)}<br>
                           <strong>Guest:</strong> ${esc(guestName)} (${esc(guests)} pax)<br>
                           <strong>Phone:</strong> ${esc(body.phone || "")}</p>
                        <p><strong>Error:</strong> ${esc(calendarErrorCode)} ${esc(calendarErrorMessage)}</p>
                        ${permissionHint}
                    </div>`,
            }),
        });
    } catch (alertError) {
        console.error("Could not send calendar alert email:", alertError);
    }
}

        // --------------------------------
        // OPENAI ADS CONVERSIONS API (Server-Side)
        // --------------------------------
        if (process.env.OPENAI_ADS_API_KEY) {
            try {
                const oaiResponse = await fetch("https://bzr.openai.com/v1/events?pid=VRzKnHH2T6PTpcTW6iwEDM", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${process.env.OPENAI_ADS_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        validate_only: false,
                        events: [
                            {
                                id: bookingReference,
                                type: "appointment_scheduled",
                                timestamp_ms: Date.now(),
                                source_url: "https://www.caliculturaltours.com/book",
                                action_source: "web",
                                data: {
                                    type: "customer_action"
                                }
                            }
                        ]
                    }),
                });

                if (!oaiResponse.ok) {
                    const errText = await oaiResponse.text();
                    console.error("OpenAI Ads Conversions API error:", errText);
                } else {
                    console.log("OpenAI Ads Conversions API event recorded:", bookingReference);
                }
            } catch (oaiError) {
                // Conversions API failure must NOT invalidate the booking
                console.error("OpenAI Ads Conversions API request failed:", oaiError);
            }
        }

        // --------------------------------
        // RESPONSE
        // --------------------------------

        return new Response(
            JSON.stringify({
                success: true,
                message: "Booking saved successfully",
                booking_reference: bookingReference,
                email_sent: resendResponse.ok,
                calendar_event_created: calendarEventCreated,
            }),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );

    } catch (error) {

        console.error("Booking error:", error);

        return new Response(
            JSON.stringify({
                success: false,
                error: error.message,
            }),
            {
                status: 500,
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );
    }
}