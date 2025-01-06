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

    players = JSON.parse(storedPlayers).map(name => {
        return {
            name,
            hits: 0,
            killer: false,
            randomNumber : 0,
            shots: 0,
            eliminated: false
        };
    });
    let numbersToAssign = assignBalancedRandomNumber(players.length);
    console.log(numbersToAssign);
    for(let i = 0; i < players.length;i++){
        players[i].randomNumber = numbersToAssign[i];
    }

    updateCurrentPlayer();
}

function assignBalancedRandomNumber(playerCount){
    let numbers = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
    let numbersToAssign = []
    let indexFirstNumber = Math.floor(Math.random() * 20);

    numbersToAssign.push(numbers[indexFirstNumber]);
    for(let i = 1;i<=5;i++){
        numbers[indexFirstNumber-3+i] = 0;
    }

    for(let i = 1; i < playerCount; i++){
        let indexNextNumber = Math.floor(Math.random()*numbers.length);
        let nextNumber = numbers[indexNextNumber];
        while(nextNumber === 0){
            indexNextNumber = Math.floor(Math.random()*numbers.length);
            nextNumber = numbers[indexNextNumber];
        }
        numbersToAssign.push(numbers[indexNextNumber]);
        for(let i = 1;i<=5;i++){
            numbers[indexNextNumber-3+i] = 0;
        }
    }

    return numbersToAssign;
}

function updateCurrentPlayer() {
    const currentPlayer = players[currentPlayerIndex];
    document.getElementById("current-player-name").innerText = `${currentPlayer.name} - ${currentPlayer.randomNumber}`;
}

function handleHit(segment) {
    const currentPlayer = players[currentPlayerIndex];

    // Save the current state to history before making changes
    history.push({
        players: JSON.parse(JSON.stringify(players)), // Deep copy to save state
        currentPlayerIndex,
    });

    currentPlayer.shots += 1;
    const hitNumber = parseInt(segment.split(' ')[1], 10);

    if (currentPlayer.hits === 3) {
        currentPlayer.killer = true;
    } else {
        currentPlayer.killer = false;
    }

    if (currentPlayer.killer) {
        for (let i = 0; i < players.length; i++) {
            if (hitNumber === players[i].randomNumber && currentPlayer.name !== players[i].name) {
                if (segment.startsWith('3x')) {
                    players[i].hits -= 3;
                }
                if (segment.startsWith('2x')) {
                    players[i].hits -= 2;
                }
                if (segment.startsWith('1x')) {
                    players[i].hits -= 1;
                }
                if (players[i].hits < 0) {
                    players[i].eliminated = true;
                }
                break;
            }
        }

    } else {
        if (segment.startsWith('3x')) {
            if (hitNumber === currentPlayer.randomNumber) {
                currentPlayer.hits = 3;
                currentPlayer.killer = true;
            }
        }
        if (segment.startsWith('2x')) {
            if (hitNumber === currentPlayer.randomNumber) {
                currentPlayer.hits += 2;
                if (currentPlayer.hits > 3) {
                    currentPlayer.hits = 3;
                    currentPlayer.killer = true;
                }
            }
        }
        if (segment.startsWith('1x')) {
            if (hitNumber === currentPlayer.randomNumber) {
                if (currentPlayer.hits < 3) {
                    currentPlayer.hits += 1;
                }
                if (currentPlayer.hits === 3) {
                    currentPlayer.killer = true;
                }
            }
        }
    }
    if (currentPlayer.shots === 3) {
        endTurn();
    }
    updatePlayerList();
}

function updatePlayerList() {
    const playerList = document.getElementById("player-list");
    playerList.innerHTML = "";

    players.forEach((player, index) => {
        const listItem = document.createElement("li");

        listItem.textContent = `${player.name} (${player.randomNumber}): ${player.hits} Treffer`;

        if (player.hits < 0) {
            listItem.style.textDecoration = "line-through";
            listItem.style.color = "gray";
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

function undoLastMove() {
    if (history.length === 0) {
        alert("No moves to undo!");
        return;
    }

    const lastState = history.pop();
    players = lastState.players;
    currentPlayerIndex = lastState.currentPlayerIndex;

    updatePlayerList();
    updateCurrentPlayer();
}

window.onload = function () {
    initializePlayers();
    updatePlayerList();
};
