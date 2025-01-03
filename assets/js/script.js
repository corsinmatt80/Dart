let players = [];
let eliminated = [];

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

function startGame() {
    const inputs = document.querySelectorAll("#name-list input");
    players = Array.from(inputs)
        .map(input => input.value.trim())
        .filter(name => name);

    if (players.length < 2) {
        alert("You need at least 2 players to start.");
        return;
    }

    assignNumbers();
    document.getElementById("name-entry").style.display = "none";
    document.getElementById("assign-numbers").style.display = "block";
}

function assignNumbers() {
    const numbers = Array.from({ length: 20 }, (_, i) => i + 1);
    const playerNumbers = players.map(name => {
        const randomIndex = Math.floor(Math.random() * numbers.length);
        return {
            name,
            number: numbers.splice(randomIndex, 1)[0],
            score: 0,
            isKiller: false
        };
    });

    players = playerNumbers;
    const list = document.getElementById("player-numbers");
    list.innerHTML = players
        .map(player => `<li>${player.name} - Number: ${player.number}</li>`)
        .join("");
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
