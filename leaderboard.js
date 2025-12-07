// Mock leaderboard data + local user
const mockData = [
  { name: "Paulo", sessions: 10, goal: "Confidence Building" },
  { name: "Aisha", sessions: 8, goal: "IELTS Prep" },
  { name: "Rahul", sessions: 7, goal: "Public Speaking" },
  { name: "Sofia", sessions: 5, goal: "Fluency Practice" },
  { name: "Karan", sessions: 3, goal: "Job Interviews" }
];

// Get current user’s stats from localStorage
const user = JSON.parse(localStorage.getItem("userProfile")) || {};
const userSessions = parseInt(localStorage.getItem("practiceCount") || "0");

if (user.name) {
  // Replace existing user or add them to leaderboard
  const index = mockData.findIndex(u => u.name === user.name);
  if (index !== -1) mockData[index].sessions = userSessions;
  else mockData.push({ name: user.name, sessions: userSessions, goal: user.goal || "Confidence" });
}

// Sort by sessions descending
mockData.sort((a, b) => b.sessions - a.sessions);

const tbody = document.querySelector("#leaderboardTable tbody");

mockData.forEach((entry, i) => {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td> ${i + 1}</td>
    <td>${entry.name}</td>
    <td>${entry.sessions}</td>
    <td>${entry.goal}</td>
  `;
  tbody.appendChild(row);
});
