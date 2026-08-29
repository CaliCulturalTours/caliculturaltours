export async function POST() {
    return new Response(
        JSON.stringify({
            success: true,
            message: "Cali Cultural Tours API is working"
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "application/json"
            }
        }
    );
}