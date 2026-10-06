/* Optional resize helper. No customer data or portal tokens are exchanged. */
(() => {
  window.addEventListener("message", event => {
    if (event.data?.type !== "surveynt:resize" || !Number.isInteger(event.data.height) || event.data.height < 200 || event.data.height > 10000) return;
    for (const frame of document.querySelectorAll("iframe[data-surveynt-embed]")) {
      let origin;
      try { origin = new URL(frame.src).origin; } catch { continue; }
      if (event.source === frame.contentWindow && event.origin === origin) frame.style.height = `${event.data.height}px`;
    }
  });
})();
