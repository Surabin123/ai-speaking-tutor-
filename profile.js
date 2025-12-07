// ========== Dashboard Toggle ==========
const dashboardBtn = document.getElementById("dashboardBtn");
const dashboardDropdown = document.getElementById("dashboardDropdown");

dashboardBtn.addEventListener("click", () => {
  dashboardDropdown.classList.toggle("show");
});

// Close dropdown if clicked outside
window.addEventListener("click", (e) => {
  if (!dashboardBtn.contains(e.target) && !dashboardDropdown.contains(e.target)) {
    dashboardDropdown.classList.remove("show");
  }
});

// ========== Edit & Logout Actions ==========
document.getElementById("editProfile").addEventListener("click", () => {
  alert("📝 Edit Profile feature coming soon!");
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  alert("👋 You have been logged out successfully!");
  window.location.href = "index.html";
});

// ========== Load User Info (from localStorage if available) ==========
window.addEventListener("load", () => {
  const user = JSON.parse(localStorage.getItem("userProfile")) || {
    name: "John Doe",
    goal: "Public Speaking Enthusiast"
  };

  document.getElementById("userName").textContent = user.name;
  document.getElementById("mainUserName").textContent = user.name;
  document.getElementById("mainUserGoal").textContent = "Goal: " + user.goal;
  document.getElementById("nameHighlight").textContent = user.name.split(" ")[0];
});




