const cookieStatus = document.getElementById("status");
const dateStatus = document.getElementById("date_s");

function showStatus(el, text, kind = "hide", hideAfter) {
  el.innerText = text;
  el.className = `status ${kind}`;
  if (hideAfter) setTimeout(() => (el.className = "status hide"), hideAfter);
}

function downloadBlob(content, filename) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/calendar;charset=utf-8" }),
  );
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: filename,
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// show whether a cookie is stored, via the input's placeholder
const cookieInput = document.getElementById("cookie");

function setCookiePlaceholder(stored) {
  cookieInput.placeholder = stored ? "Cookie saved" : "No cookie saved";
}

(async () => {
  cookieInput.placeholder = "Checking...";
  try {
    const res = await fetch("/api/store");
    if (!res.ok) throw new Error(res.status);
    setCookiePlaceholder((await res.json()).stored);
  } catch {
    cookieInput.placeholder = "Couldn't check cookie status";
  }
})();

// save cookie
document.getElementById("save").addEventListener("click", async () => {
  let ok = false;
  try {
    const res = await fetch("/api/store", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: document.getElementById("cookie").value,
    });
    ok = res.ok;
  } catch {}
  if (ok) setCookiePlaceholder(true);

  showStatus(
    cookieStatus,
    ok ? "Cookie saved!" : "Failed to save cookie!",
    ok ? "green" : "red",
    2000,
  );
});

// download timetable
for (const btn of document.getElementsByClassName("download-btn")) {
  btn.addEventListener("click", async (e) => {
    const mode = e.target.id;

    const start = document.getElementById("date1").value;
    const end = document.getElementById("date2").value;
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);

    if (isNaN(startMs) || isNaN(endMs) || startMs > endMs) {
      showStatus(dateStatus, "Invalid range!", "red");
      return;
    }
    showStatus(dateStatus, "");

    btn.disabled = true;
    try {
      const res = await fetch(
        `/api/timetable?${new URLSearchParams({ start, end, mode })}`,
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err.error || `Request failed (${res.status})`,
        );
      }

      if (mode === "merged") {
        downloadBlob(
          await res.text(),
          `timetable_${start}_${end}.ics`,
        );
        return;
      }

      // split: { moduleName: .ics text }
      const entries = Object.entries(await res.json());
      if (!entries.length) {
        showStatus(dateStatus, "No classes found in that range.", "red");
        return;
      }
      for (const [title, ics] of entries) {
        downloadBlob(
          ics,
          `${title.replace(/[^\w.-]+/g, "_")}.ics`,
        );
        await new Promise((r) => setTimeout(r, 300)); // avoid the browser blocking a burst of downloads
      }
    } catch (err) {
      showStatus(dateStatus, err.message, "red");
    } finally {
      btn.disabled = false;
    }
  });
}
