let players = [];
let currentPlayerIndex = 0;
let history = []; // To store the history of moves

function initializePlayers() {
    const storedPlayers = localStorage.getItem("players");
    if (!storedPlayers) {
        alert("No players found! Redirecting to setup...");
        window.location.href = "index.html";
        return;
    }

    players = JSON.parse(storedPlayers).map(name => ({
        name,
        score: 501, // Starting score for each player
        shots: 0
    }));

    console.log("PLAYERS");
    console.log(players);
    updateCurrentPlayer();
}

function updateCurrentPlayer() {
    const currentPlayer = players[currentPlayerIndex];
    document.getElementById("current-player-name").innerText = `${currentPlayer.name} - Score: ${currentPlayer.score}`;
}

function handleHit(segment) {
    const currentPlayer = players[currentPlayerIndex];
    currentPlayer.shots++;

    let multiplier = 1;
    if (segment.startsWith("2x")) multiplier = 2;
    if (segment.startsWith("3x")) multiplier = 3;

    const hitNumber = parseInt(segment.split(" ")[1], 10);
    const points = multiplier * hitNumber;

    // Save the current state to history before modifying
    history.push({
        currentPlayerIndex,
        currentPlayerScore: currentPlayer.score,
        currentPlayerShots: currentPlayer.shots - 1 // Subtract 1 because it was incremented earlier
    });

    // Check if the player busts
    if (currentPlayer.score - points < 0) {
        console.log(`${currentPlayer.name} busted!`);
    } else if (currentPlayer.score - points === 0) {
        if (multiplier === 2) {
            alert(`${currentPlayer.name} wins!`);
            resetGame();
            return;
        } else {
            console.log(`${currentPlayer.name} must finish on a double!`);
        }
    } else {
        currentPlayer.score -= points;
    }

    if (currentPlayer.shots === 3) {
        endTurn();
    }
    updateCurrentPlayer();
    updatePlayerList();
}

function updatePlayerList() {
    const playerList = document.getElementById("player-list");
    playerList.innerHTML = "";

    players.forEach(player => {
        const listItem = document.createElement("li");
        listItem.textContent = `${player.name}: ${player.score} points`;

        if (player.score === 0) {
            listItem.style.textDecoration = "line-through";
            listItem.style.color = "green";
        }

        playerList.appendChild(listItem);
    });
}

function endTurn() {
    do {
        currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
        currentPlayer = players[currentPlayerIndex];
        currentPlayer.shots = 0;
    } while (players[currentPlayerIndex].eliminated);

    updateCurrentPlayer();
}

function resetGame() {
    localStorage.removeItem("players");
    window.location.href = "index.html";
}

function undoLastMove() {
    if (history.length === 0) {
        alert("No moves to undo!");
        return;
    }

    const lastMove = history.pop();
    currentPlayerIndex = lastMove.currentPlayerIndex;

    const currentPlayer = players[currentPlayerIndex];
    currentPlayer.score = lastMove.currentPlayerScore;
    currentPlayer.shots = lastMove.currentPlayerShots;

    updateCurrentPlayer();
    updatePlayerList();
}

window.onload = function () {
    initializePlayers();
    updatePlayerList();
};
