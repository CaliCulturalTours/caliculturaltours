import { google } from "googleapis";
import { randomUUID } from "crypto";

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
    const tourInfoResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: "TOUR INFO!A:C",
    });

    const tourInfoRows = tourInfoResponse.data.values || [];

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
        // SAVE BOOKING TO GOOGLE SHEETS
        // --------------------------------

        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: "Sheet1!A:L",
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
                    body.total || "",
                    bookingReference,
                    body.payment_status || "Pending",
                    body.bold_transaction_id || "",
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
                    <strong>${Number(body.total || 0).toLocaleString("en-US")} COP</strong>
                </p>

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
            ${Number(body.total || 0).toLocaleString("en-US")} COP
        </p>

        <p>
            <strong>Payment:</strong><br>
            ${body.payment_status === "Cash"
                ? "Cash payment — 10% discount applied"
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

try {
    // Convert date + time into a local Cali/Bogotá date
    const timeMatch = String(tourTime).match(
        /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i
    );

    if (!timeMatch) {
        throw new Error(`Invalid tour time: ${tourTime}`);
    }

    let hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const period = timeMatch[3].toUpperCase();

    if (period === "PM" && hours !== 12) {
        hours += 12;
    }

    if (period === "AM" && hours === 12) {
        hours = 0;
    }

    // Robust duration parsing: handles "4:00:00", "04:00", "4 hours", "3.5", etc.
    let durationH = 4;
    let durationM = 0;

    const timeParts = String(durationHours).match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (timeParts) {
        durationH = Number(timeParts[1]);
        durationM = Number(timeParts[2]);
    } else {
        const hoursNumber = parseFloat(String(durationHours).replace(/[^0-9.]/g, ''));
        if (!isNaN(hoursNumber) && hoursNumber > 0) {
            durationH = Math.floor(hoursNumber);
            durationM = Math.round((hoursNumber - durationH) * 60);
        }
    }

    // Create ISO-like local date/time strings.
    // Calendar receives the explicit America/Bogota timezone.
    const startDateTime =
        `${tourDate}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;

    const startDate = new Date(`${startDateTime}-05:00`);

    const endDate = new Date(
    startDate.getTime() +
    (durationH * 60 + durationM) * 60 * 1000
);

const pad = (value) => String(value).padStart(2, "0");

// Convert the calculated UTC time back to America/Bogota local time.
// Cali/Bogota is UTC-5 year-round.
const endYear = endDate.getUTCFullYear();
const endMonth = endDate.getUTCMonth() + 1;
const endDay = endDate.getUTCDate();
const endHour = endDate.getUTCHours() - 5;
const endMinute = endDate.getUTCMinutes();

// Because the end time may cross midnight, use a proper local-date
// calculation rather than simply subtracting 5 from the hour.
const endLocalDate = new Date(
    Date.UTC(endYear, endMonth - 1, endDay, endHour, endMinute)
);

const endDateTime =
    `${endLocalDate.getUTCFullYear()}-${pad(endLocalDate.getUTCMonth() + 1)}-${pad(endLocalDate.getUTCDate())}` +
    `T${pad(endLocalDate.getUTCHours())}:${pad(endLocalDate.getUTCMinutes())}:00`;

    const calendarDescription = `
Booking reference: ${bookingReference}

Guest: ${guestName}
Email: ${body.email || ""}
WhatsApp: ${body.phone || ""}
Guests: ${guests}

Tour: ${tourName}
Payment: ${body.payment_status || "Pending"}
Total: ${Number(body.total || 0).toLocaleString("en-US")} COP

Meeting point:
${meetingPoint}
`.trim();

    await calendar.events.insert({
        calendarId:
            "065ab151764dd23fe55535b74252ec1b553a43c9918a47d7957e9db771a96d18@group.calendar.google.com",

        requestBody: {
            summary: `${tourName} — ${guestName}`,

            description: calendarDescription,

            start: {
                dateTime: startDateTime,
                timeZone: "America/Bogota",
            },

            end: {
                dateTime: endDateTime,
                timeZone: "America/Bogota",
            },
        },
    });

    calendarEventCreated = true;

    console.log("Calendar event created:", {
        booking_reference: bookingReference,
        start: startDateTime,
        end: endDateTime,
    });

} catch (calendarError) {

    // Calendar failure must NOT invalidate the booking
    console.error("Google Calendar error:", calendarError);
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