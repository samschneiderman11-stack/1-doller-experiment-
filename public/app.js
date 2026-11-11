const form = document.querySelector("#signup");
const message = document.querySelector("#signup-message");
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "Adding you...";
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const response = await fetch("/api/subscribe", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        email: document.querySelector("#email").value,
        consent: document.querySelector("#consent").checked
      })
    });
    const data = await response.json();
    message.textContent = data.message || data.error || "Something went wrong.";
    if (response.ok) form.reset();
  } catch { message.textContent = "Connection problem. Please try again."; }
  finally { button.disabled = false; }
});
document.querySelector("#pay")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await fetch("/api/create-checkout-session", {method:"POST"});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Checkout unavailable.");
    location.href = data.url;
  } catch (err) { alert(err.message); }
  finally { button.disabled = false; }
});
const params = new URLSearchParams(location.search);
if (params.get("payment") === "success") alert("Thanks for supporting the experiment!");
if (params.get("payment") === "cancelled") alert("Checkout was cancelled. No payment was made.");
