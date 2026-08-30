import { google } from "googleapis";
import { randomUUID } from "crypto";

export async function POST({ request }) {
    try {
        const body = await request.json();

        // Generate unique booking reference
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
        // SEND EMAIL VIA RESEND
        // --------------------------------

        const whatsappNumber = String(body.phone || "")
            .replace(/\D/g, "");

        const whatsappMessage =
            `Hi ${body.name || ""}! This is Juan from Cali Cultural Tours. ` +
            `I received your booking request for the ${body.tour || ""} ` +
            `on ${body.date || ""} at ${body.time || ""}. ` +
            `Your booking reference is ${bookingReference}.`;

        const whatsappUrl =
            `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`;

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

                <h3>${body.tour || ""}</h3>

                <p>📅 <strong>Date:</strong> ${body.date || ""}</p>
                <p>🕐 <strong>Start time:</strong> ${body.time || ""}</p>
                <p>👥 <strong>Guests:</strong> ${body.guests || ""}</p>

                <h3>Guest</h3>

                <p>
                    <strong>${body.name || ""}</strong><br>
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

                <p style="font-size: 12px; color: #999;">
                    Cali Cultural Tours booking system
                </p>

            </div>
        `;

        const resendResponse = await fetch("https://api.resend.com/emails", {
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
        });

        const resendData = await resendResponse.json();

        // Email failure should NOT invalidate the booking
        if (!resendResponse.ok) {
            console.error("Resend error:", resendData);
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