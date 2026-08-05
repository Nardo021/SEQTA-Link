(function () {
  function toast(message, type) {
    if (typeof Toastify === "undefined") return;
    Toastify({
      text: message,
      duration: 4000,
      gravity: "top",
      position: "right",
      style: {
        background: type === "error" ? "#b91c1c" : "#166534",
      },
    }).showToast();
  }

  async function api(path, options) {
    const response = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options && options.headers) },
      ...options,
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const message = (body && body.error && body.error.message) || text || "Request failed";
      const err = new Error(message);
      err.status = response.status;
      throw err;
    }
    return body;
  }

  function navigateWithTransition(url) {
    if (document.startViewTransition) {
      document.startViewTransition(function () {
        window.location.href = url;
      });
    } else {
      window.location.href = url;
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-auto-animate]").forEach(function (el) {
      if (typeof autoAnimate !== "undefined") autoAnimate(el);
    });

    document.querySelectorAll(".nav a[href^='/']").forEach(function (link) {
      link.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        const href = link.getAttribute("href");
        if (!href || href.startsWith("#")) return;
        e.preventDefault();
        navigateWithTransition(href);
      });
    });

    document.querySelectorAll("[data-fetch-action]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        const path = btn.dataset.fetchAction;
        const method = btn.dataset.fetchMethod || "POST";
        try {
          await api(path, { method, body: "{}" });
          toast(btn.dataset.successMessage || "Done.", "success");
          if (btn.dataset.reload) window.location.reload();
        } catch (e) {
          toast(e.message || "Request failed.", "error");
        }
      });
    });
  });

  window.seqtaApi = api;
  window.seqtaToast = toast;
  window.seqtaNavigate = navigateWithTransition;
})();
