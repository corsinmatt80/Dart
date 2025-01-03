function addNameField() {
    const list = document.getElementById("name-list");
    if (list.children.length >= 10) {
        alert("You can only add up to 10 players.");
        return;
    }
    const li = document.createElement("li");
    li.innerHTML = `<input type="text" placeholder="Enter player name">`;
    list.appendChild(li);
}

function redirectToGame() {
    const inputs = document.querySelectorAll("#name-list input");
    const players = Array.from(inputs)
        .map(input => input.value.trim())
        .filter(name => name);

    if (players.length < 2) {
        alert("You need at least 2 players to start.");
        return;
    }

    // Save player names to localStorage
    localStorage.setItem("players", JSON.stringify(players));

    // Redirect to game page
    window.location.href = "game.html";
}
