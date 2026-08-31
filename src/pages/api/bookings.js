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
            ],
        });

        const sheets = google.sheets({
            version: "v4",
            auth,
        });

        
// --------------------------------
// GET TOUR INFO
// --------------------------------

const tourInfoResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "TOUR INFO!A:C",
});

const tourInfoRows = tourInfoResponse.data.values || [];

const tourInfo = tourInfoRows.find(
    row => row[0] === body.tour_id
);

const durationHours = tourInfo ? tourInfo[1] : "";
const meetingPoint = tourInfo ? tourInfo[2] : "";

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