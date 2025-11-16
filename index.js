import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import postgres from "postgres";
import "dotenv/config";
import console from "node:console";

if (!process.env.POSTGRES_URL) {
	throw new Error("POSTGRES_URL environment variable is not defined");
}
const sql = postgres(process.env.POSTGRES_URL, {
	ssl: "require",
	idle_timeout: 300,
	connect_timeout: 60,
	prepare: false,
});

const app = express();
const server = createServer(app);
const io = new Server(server, {
	cors: {
		origin: [
			"http://localhost:3000",
			"https://next-chat-discord-clone.vercel.app",
			"https://telegram-clone-five-delta.vercel.app",
			"https://discord-clone-ten-iota.vercel.app",
			"https://telegram-clone-ambitiouscalvins-projects.vercel.app",
			"https://telegram-clone-git-main-ambitiouscalvins-projects.vercel.app",
		],
		credentials: true,
	},
});

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get("/", (req, res) => {
	res.sendFile(join(__dirname, "index.html"));
});

io.on("connection", (socket) => {
	socket.on("join-video", (roomId) => {
		socket.join(roomId);
		socket.to(roomId).emit("peer-joined");
	});

	socket.on("offer-video", (data) => {
		socket.to(data.roomId).emit("offer-video", data.offer);
	});

	socket.on("answer-video", (data) => {
		socket.to(data.roomId).emit("answer-video", data.answer);
	});

	socket.on("ice-candidate", (data) => {
		socket.to(data.roomId).emit("ice-candidate", data.candidate);
	});
});


const PORT = process.env.PORT || 8000;

server.listen(PORT, () => {
	if (process.env.NODE_ENV === "production") {
		console.log(`Server running in production on port ${PORT}`);
	} else {
		console.log(`Server running locally at http://localhost:${PORT}`);
	}
});
