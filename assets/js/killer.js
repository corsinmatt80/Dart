let players = [];
let eliminated = [];

document.addEventListener("DOMContentLoaded", () => {
    const savedPlayers = JSON.parse(localStorage.getItem("players")) || [];
    if (savedPlayers.length === 0) {
        alert("No players found. Redirecting to name entry.");
        window.location.href = "index.html";
    }

    // Assign random numbers to players
    const numbers = Array.from({ length: 20 }, (_, i) => i + 1);
    players = savedPlayers.map(name => {
        const randomIndex = Math.floor(Math.random() * numbers.length);
        return {
            name,
            number: numbers.splice(randomIndex, 1)[0],
            score: 0,
            isKiller: false
        };
    });

    displayPlayerNumbers();
    drawDartboard();
});

function displayPlayerNumbers() {
    const list = document.getElementById("player-numbers");
    list.innerHTML = players
        .map(player => `<li>${player.name} - Number: ${player.number}</li>`)
        .join("");
}

function drawDartboard() {
    const dartboard = document.getElementById("dartboard");
    const totalSegments = 20;
    const angle = 360 / totalSegments;

    for (let i = 0; i < totalSegments; i++) {
        const segment = document.createElement("div");
        segment.classList.add("segment");
        segment.style.transform = `rotate(${i * angle}deg)`;

        const span = document.createElement("span");
        const player = players.find(p => p.number === i + 1);
        span.innerText = `${i + 1}${player ? `\n(${player.name})` : ""}`;
        segment.appendChild(span);

        dartboard.appendChild(segment);
    }
}

function startGamePlay() {
    document.getElementById("assign-numbers").style.display = "none";
    document.getElementById("game-play").style.display = "block";
    updateGameStatus();
}

function updateGameStatus() {
    const status = document.getElementById("game-status");
    status.innerHTML = players
        .map(player =>
            `<li>${player.name} (Number: ${player.number}) - 
             Score: ${player.score} ${player.isKiller ? "(Killer)" : ""}</li>`
        )
        .join("");
}

function hitTarget() {
    const playerName = document.getElementById("player-name").value.trim();
    const targetNumber = parseInt(document.getElementById("target-number").value);

    const player = players.find(p => p.name === playerName);
    if (!player) {
        alert("Player not found.");
        return;
    }

    if (player.isKiller) {
        const target = players.find(p => p.number === targetNumber);
        if (!target) {
            alert("Target number not found.");
            return;
        }

        if (eliminated.includes(target.name)) {
            alert("Target is already eliminated.");
        } else {
            eliminated.push(target.name);
            players = players.filter(p => p.name !== target.name);
            alert(`${player.name} eliminated ${target.name}!`);
        }
    } else if (player.number === targetNumber) {
        player.score++;
        if (player.score === 3) {
            player.isKiller = true;
            alert(`${player.name} is now a Killer!`);
        }
    } else {
        alert("Invalid target. Only hit your assigned number.");
    }

    updateGameStatus();
    updateEliminatedList();
}

function updateEliminatedList() {
    const list = document.getElementById("eliminated-list");
    list.innerHTML = eliminated.map(name => `<li>${name}</li>`).join("");
}
