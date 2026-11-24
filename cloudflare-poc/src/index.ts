/** Fail-closed runtime spike: NO application/API/ICS routes. Not production-ready. */
export default {
  fetch(_request: Request): Response {
    return new Response("Compatibility experiment only", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  },
} satisfies ExportedHandler;
