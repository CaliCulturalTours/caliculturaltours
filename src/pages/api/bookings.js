import { google } from "googleapis";

export async function POST({ request }) {
    try {
        const body = await request.json();

        const auth = new google.auth.GoogleAuth({
            credentials: {
                client_email: process.env.GOOGLE_CLIENT_EMAIL,
                private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
            },
            scopes: [
                "https://www.googleapis.com/auth/spreadsheets",
            ],
        });

        const sheets = google.sheets({
            version: "v4",
            auth,
        });

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
                    body.booking_reference || "",
                    body.payment_status || "Pending",
                    body.bold_transaction_id || "",
                ]],
            },
        });

        return new Response(
            JSON.stringify({
                success: true,
                message: "Booking saved successfully",
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