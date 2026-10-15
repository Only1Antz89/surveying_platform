"use client";

/** Provider HTML is displayed unchanged inside a unique-origin, script-free sandbox. */
export function GoogleSearchSuggestions({ html }: { html: string }) {
 const policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: https://www.gstatic.com https://www.google.com; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-src 'none'";
 return <iframe title="Google Search Suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={`<meta http-equiv="Content-Security-Policy" content="${policy}">${html}`} style={{ width: "100%", height: 200, border: 0 }} />;
}
