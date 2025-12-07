function pullCord() {
  const light = document.querySelector('.lamp-light');
  const mouth = document.querySelector('.mouth');
  const loginBox = document.getElementById('loginBox');

  const isOn = light.style.opacity === "1";

  if (isOn) {
    light.style.opacity = "0";
    mouth.setAttribute("d", "M43,80 Q50,85 57,80"); // normal mouth
    loginBox.classList.remove("show");
  } else {
    light.style.opacity = "1";
    mouth.setAttribute("d", "M43,80 Q50,90 57,80"); // smile
    loginBox.classList.add("show");
  }
}

function goBack() {
  window.location.href = "home.html";
}

document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const username = e.target.querySelector('input[type="text"]').value;
  const password = e.target.querySelector('input[type="password"]').value;

  if (username === "admin" && password === "12345") {
    alert("Login successful!");
    window.location.href = "home.html";
  } else {
    alert("Invalid credentials!");
  }
});

