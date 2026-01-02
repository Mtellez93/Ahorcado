const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gameState = {
    palabra: "",
    letrasAdivinadas: [],
    vidas: 6,
    errores: 0,
    turno: "Wuachiturros",
    capitanes: { Wuachiturros: null, Chapisa: null },
    setupCompleto: false
};

io.on('connection', (socket) => {
    // Al conectarse, enviamos el estado actual
    socket.emit('updateState', gameState);

    socket.on('setRole', (equipo) => {
        if (!gameState.capitanes[equipo]) {
            gameState.capitanes[equipo] = socket.id;
            socket.emit('roleAssign', { role: 'capitan', equipo });
        } else {
            socket.emit('roleAssign', { role: 'jugador', equipo });
        }
    });

    socket.on('startGame', (data) => {
        // Solo el capitán del equipo contrario o el primero que configure
        gameState.palabra = data.palabra.toUpperCase();
        gameState.vidas = data.vidas;
        gameState.letrasAdivinadas = [];
        gameState.errores = 0;
        gameState.setupCompleto = true;
        io.emit('updateState', gameState);
    });

    socket.on('intentarLetra', (data) => {
        if (data.equipo !== gameState.turno) return;

        const letra = data.letra.toUpperCase();
        if (!gameState.letrasAdivinadas.includes(letra)) {
            gameState.letrasAdivinadas.push(letra);
            if (!gameState.palabra.includes(letra)) {
                gameState.errores++;
            }
            // Lógica simple de cambio de turno si falla o siempre
            // Aquí lo dejaremos fijo hasta que el servidor decida
            io.emit('updateState', gameState);
        }
    });
});

server.listen(3000, () => console.log('Servidor corriendo en puerto 3000'));
