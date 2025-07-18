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
		origin: "http://localhost:3000", // [] for multiple origin
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
		console.log("socket joined:", room);
	});

	socket.on("create_dm", async ({}) => {});

	// request friendship
	socket.on("request_friendship", async ({ friend_id, user_id }) => {
		try {
			await sql.begin(async (sql) => {
				await sql`
					INSERT INTO friends (user_id, friend_id, status)
					VALUES (${user_id}, ${friend_id}, 'pending')
				`;
			});

			console.log(`Success: request_friendship`);
		} catch (error) {
			console.error(error);
		}
	});

	// accept friendship
	socket.on("accept_friendship", async ({ friend_id, user_id, room_id }) => {
		try {
			await sql.begin(async (sql) => {
				await sql`
					UPDATE friends
					SET status = 'accepted'
					WHERE user_id = ${user_id} AND friend_id = ${friend_id}
				`;

				await sql`
					INSERT INTO rooms (id, type)
					VALUES (${room_id}, 'dm')
					ON CONFLICT DO NOTHING
				`;

				await sql`
					INSERT INTO room_members (room_id, user_id)
					VALUES
						(${room_id}, ${user_id}),
						(${room_id}, ${friend_id})
					ON CONFLICT DO NOTHING
				`;
			});

			console.log(`Success: accept_friendship`);
		} catch (error) {
			console.error(error);
		}
	});

	// send message
	socket.on("message", async ({ room: room_id, sender_id, sender_display_name, content, type = "text" }) => {
		try {
			await sql.begin(async (sql) => {
				const [{ id }] = await sql`
					INSERT INTO messages (room_id, sender_id, sender_display_name, content, type)
					VALUES (${room_id}, ${sender_id}, ${sender_display_name}, ${content}, ${type})
					RETURNING id
				`;

				await sql`
					UPDATE rooms
					SET last_msg_id = ${id}
					WHERE id = ${room_id}
				`;
			});

			const msg = {
				sender_id,
				sender_display_name,
				content,
				created_at: new Date().toISOString(),
			};

			io.to(room_id).emit("message", msg);
			console.log("Sent:", msg);
		} catch (error) {
			console.error("insert msg failed", error);
		}
	});

	// leave room
	socket.on("leave", (room) => socket.leave(room));
});

server.listen(8000, () => {
	console.log("server running at http://localhost:8000");
});
