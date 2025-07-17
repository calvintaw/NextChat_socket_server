import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import postgres from "postgres";
import "dotenv/config";
import { create } from "node:domain";

const sql = postgres(process.env.POSTGRES_URL, {
	ssl: "require",
	connect_timeout: 30,
	idle_timeout: 60,
});

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

io.on("connection", (socket) => {
	// join
	socket.on("join", (room) => {
		socket.join(room);
		console.log("socket joined: ", room);
	});
	// msg
	socket.on("message", async ({ room, sender_id, sender_displayName, content, type = "text" }) => {
		try {
			await sql`insert into messages (room_id, sender_id, sender_displayName, content, type) values (
				${room},
				${sender_id},
				${sender_displayName},
				${content},
				${type}
			)`;

			const msg = {
				sender_id,
				sender_displayName,
				content,
				createdAt: new Date().toISOString(),
			};

			io.to(room).emit("message", msg);
			console.log("Sent: ", msg);
		} catch (error) {
			console.error("insert msg failed ", error);
		}
	});

	// leave room
	socket.on("leave", (room) => socket.leave(room));
});

server.listen(8000, () => {
	console.log("server running at http://localhost:8000");
});
