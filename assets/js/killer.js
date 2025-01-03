document.addEventListener("DOMContentLoaded", () => {
    // Spieler aus localStorage laden
    const savedPlayers = JSON.parse(localStorage.getItem("players")) || [];
    if (savedPlayers.length === 0) {
        alert("Keine Spieler gefunden. Zurück zur Namenseingabe.");
        window.location.href = "index.html";
        return;
    }

    // Zufällige Nummern zuweisen
    const numbers = Array.from({ length: 20 }, (_, i) => i + 1);
    players = savedPlayers.map(name => {
        const randomIndex = Math.floor(Math.random() * numbers.length);
        return {
            name,
            number: numbers.splice(randomIndex, 1)[0],
            hits: 0
        };
    });

    displayPlayerNumbers();
    updateCurrentPlayerDisplay(); // Zeige den ersten Spieler an

    // Bullseye-Event registrieren
    const bullseye = document.querySelector('.bullseye');
    if (bullseye) {
        bullseye.addEventListener("click", () => handleHit("bullseye"));
    }
});

function displayPlayerNumbers() {
    const list = document.getElementById("player-numbers");
    list.innerHTML = players
        .map(player => `<li>${player.name} - Number: ${player.number}</li>`)
        .join("");
}

function handleHit(number) {
    const player = players[currentPlayerIndex];

    if (number === "bullseye") {
        player.hits += 2; // Bullseye zählt doppelt
        alert(`${player.name} hat das Bullseye getroffen! Trefferanzahl: ${player.hits}`);
    } else if (player.number === number) {
        player.hits++;
        alert(`${player.name} hat Nummer ${number} getroffen! Trefferanzahl: ${player.hits}`);
    } else {
        alert(`${player.name} hat Nummer ${number} getroffen, aber das ist nicht sein Ziel!`);
    }

    if (player.hits >= 3) {
        alert(`${player.name} hat seine Runde abgeschlossen!`);
        endTurn();
    }
}

function endTurn() {
    currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
    updateCurrentPlayerDisplay(); // Aktualisiere den angezeigten Spieler
    console.log(players);
}

function updateCurrentPlayerDisplay() {
    const currentPlayerElement = document.getElementById("current-player-name");
    currentPlayerElement.textContent = players[currentPlayerIndex].name;
}
