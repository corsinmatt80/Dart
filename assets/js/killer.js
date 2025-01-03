let players = [];
let currentPlayerIndex = 0;

function initializePlayers() {
    const storedPlayers = localStorage.getItem("players");
    if (!storedPlayers) {
        alert("No players found! Redirecting to setup...");
        window.location.href = "index.html";
        return;
    }

    let availableNumbers = Array.from({ length: 20 }, (_, i) => i + 1);

    players = JSON.parse(storedPlayers).map(name => {
        const randomIndex = Math.floor(Math.random() * availableNumbers.length);
        const randomNumber = availableNumbers.splice(randomIndex, 1)[0];

        return {
            name,
            hits: 0,
            killer: false,
            randomNumber,
            shots: 0
        };
    });

    console.log("PLAYERS");
    console.log(players);
    updateCurrentPlayer();
}

function updateCurrentPlayer() {
    const currentPlayer = players[currentPlayerIndex];
    document.getElementById("current-player-name").innerText = `${currentPlayer.name} - ${currentPlayer.randomNumber}`;
}

function handleHit(segment) {
    const currentPlayer = players[currentPlayerIndex];
    currentPlayer.shots = currentPlayer.shots + 1;
    const hitNumber = parseInt(segment.split(' ')[1], 10);

    if (currentPlayer.killer) {
        for(let i = 0; i < players.length;i++){
            if(hitNumber === players[i].randomNumber && currentPlayer.name !== players[i].name){
                if(segment.startsWith('3x')){
                    players[i].hits = players[i].hits - 3;
                }
                if(segment.startsWith('2x')) {
                    players[i].hits = players[i].hits - 2;
                }
                if(segment.startsWith('1x')) {
                    players[i].hits = players[i].hits - 1;
                }
                if(players[i].hits < 0){
                    players.splice(i,1);
                }
            }
        }

    } else {
        if (segment.startsWith('3x')) {
            const hitNumber = parseInt(segment.split(' ')[1], 10);
            if (hitNumber === currentPlayer.randomNumber) {
                currentPlayer.hits = 3;
                currentPlayer.killer = true;
                console.log(`Hits of ${currentPlayer.name} : ${currentPlayer.hits}`);
            }
        }
        if (segment.startsWith('2x')) {
            if (hitNumber === currentPlayer.randomNumber) {
                currentPlayer.hits = currentPlayer.hits + 2;
                if (currentPlayer.hits > 3) {
                    currentPlayer.hits = 3;
                    currentPlayer.killer = true;
                }
                console.log(`Hits of ${currentPlayer.name} : ${currentPlayer.hits}`);
            }
        }
        if (segment.startsWith('1x')) {
            if (hitNumber === currentPlayer.randomNumber) {
                currentPlayer.hits = currentPlayer.hits + 2;
                if (currentPlayer.hits < 3) {
                    currentPlayer.hits = currentPlayer.hits + 1;
                }
                if(currentPlayer.hits === 3){
                    currentPlayer.killer = true;
                }
                console.log(`Hits of ${currentPlayer.name} : ${currentPlayer.hits}`);
            }
        }
    }
    if(currentPlayer.shots === 3){
        endTurn();
    }
}


function endTurn() {
    currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
    updateCurrentPlayer();
}

window.onload = function () {
    initializePlayers();
};
