import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";

const app = express();
const server = createServer(app);
const io = new Server(server, {
	cors: {
		origin: "http://localhost:3000", // or multiple origins in an array
		credentials: true,
	},
});

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get("/", (req, res) => {
	res.sendFile(join(__dirname, "index.html"));
});

const messages = {
	general: "Welcome to General chat!",
	random: "Random chat starts here.",
	support: "How can we help you?",
};

io.on("connection", (socket) => {
	console.log("a user connected");

	socket.on("join room", ({ username, room }) => {
		socket.join(room);
		socket.emit(room, `${messages[room]} ${username}`);
		socket.to(room).emit(room, `${username} joined ${room}`);
		console.log(`Joined ${room}`);
	});

	socket.on("chat message", ({ username, room, msg }) => {
		io.to(room).emit("chat message", { username, room, msg });
		console.log(`Msg by ${username} to ${room}: '${msg}'`);
	});
});

server.listen(8000, () => {
	console.log("server running at http://localhost:8000");
});
