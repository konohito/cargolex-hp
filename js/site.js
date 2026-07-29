/* CARGOLEX — site.js: モバイルナビ / ヘッダー影 / お問い合わせフォーム */
(function () {
  "use strict";

  /* ---------- モバイルドロワーナビ ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var drawer = document.getElementById("nav-drawer");
  var header = document.querySelector(".site-header");

  function setDrawer(open) {
    if (!toggle || !drawer) return;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
    drawer.classList.toggle("open", open);
    if (open) {
      drawer.removeAttribute("hidden");
    } else {
      drawer.setAttribute("hidden", "");
    }
  }

  if (toggle && drawer) {
    toggle.addEventListener("click", function () {
      setDrawer(toggle.getAttribute("aria-expanded") !== "true");
    });
    drawer.addEventListener("click", function (e) {
      if (e.target.closest("a")) setDrawer(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setDrawer(false);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 1024) setDrawer(false);
    });
  }

  /* ---------- スクロール時のヘッダー影 ---------- */
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- お問い合わせフォーム ----------
     送信先を用意できたら FORM_ENDPOINT に Formspree 等のエンドポイント
     （例: "https://formspree.io/f/xxxxxxxx"）を設定してください。
     未設定の間は、電話への誘導メッセージを表示します。 */
  var FORM_ENDPOINT = "";

  var form = document.getElementById("contact-form");
  var status = document.getElementById("form-status");

  function showStatus(kind, message) {
    if (!status) return;
    status.textContent = message;
    status.className = "form-status " + kind;
    status.removeAttribute("hidden");
    status.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;

      if (!FORM_ENDPOINT) {
        showStatus(
          "notice",
          "申し訳ございません。メールフォームは現在準備中です。お手数ですが、お電話（080-3978-0369／8:00〜20:00・年中無休）または InstagramのDM にてお問い合わせください。"
        );
        return;
      }

      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      fetch(FORM_ENDPOINT, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" }
      })
        .then(function (res) {
          if (!res.ok) throw new Error("send failed");
          form.reset();
          showStatus("success", "お問い合わせを送信しました。内容を確認次第、お電話またはメールにてご連絡いたします。");
        })
        .catch(function () {
          showStatus(
            "error",
            "送信に失敗しました。お手数ですが、時間をおいて再度お試しいただくか、お電話（080-3978-0369）にてお問い合わせください。"
          );
        })
        .finally(function () {
          if (button) button.disabled = false;
        });
    });
  }
})();
