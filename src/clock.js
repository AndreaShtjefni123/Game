

export let survivalTime = 0;

export function updateClock() {
    survivalTime += 1 / 60; // adds 1/60 second each frame
    document.getElementById('timer').textContent = 'Time: ' + Math.floor(survivalTime) + 's';
}

export function showFinalTime() {
    document.getElementById('finalTime').textContent = '⏱ You survived ' + Math.floor(survivalTime) + ' seconds';
}