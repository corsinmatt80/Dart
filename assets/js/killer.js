let players = [];
let currentPlayerIndex = 0;

function initializePlayers() {
    const storedPlayers = localStorage.getItem("players");
    if (!storedPlayers) {
        alert("No players found! Redirecting to setup...");
        window.location.href = "index.html";
        return;
    }

    players = JSON.parse(storedPlayers).map(name => ({
        name,
        lives: 3,
        killer: false
    }));

    // Aktuellen Spieler anzeigen
    updateCurrentPlayer();
}

// Aktuellen Spieler anzeigen
function updateCurrentPlayer() {
    const currentPlayer = players[currentPlayerIndex];
    document.getElementById("current-player-name").innerText = currentPlayer.name;
}

// Treffer-Handling
function handleHit(segment) {
    const currentPlayer = players[currentPlayerIndex];

    // Beispiel: Trefferlogik
    if (currentPlayer.killer) {
        // Wenn der Spieler ein Killer ist, kann er andere Spieler angreifen
        console.log(`${currentPlayer.name} hit ${segment}`);
    } else {
        // Wenn der Spieler kein Killer ist, trifft er auf seine eigenen Segmente
        console.log(`${currentPlayer.name} scored on ${segment}`);
    }
}

// Zug beenden
function endTurn() {
    // Zum nächsten Spieler wechseln
    currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
    updateCurrentPlayer();
}

// Eventlistener hinzufügen
window.onload = function () {
    initializePlayers();
};
