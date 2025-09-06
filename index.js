import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import postgres from "postgres";
import "dotenv/config";

if (!process.env.POSTGRES_URL) {
	throw new Error("POSTGRES_URL environment variable is not defined");
}
const sql = postgres(process.env.POSTGRES_URL, {
	ssl: "require",
	connect_timeout: 30,
	idle_timeout: 60,
});

const app = express();
const server = createServer(app);
const io = new Server(server, {
	cors: {
		origin: [
			"http://localhost:3000",
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


const userSockets = new Map();
const timeoutMap = new Map();

io.on("connection", (socket) => {
	



	//=======================================

	socket.on("join", (room_id) => {
		socket.join(room_id);
		console.log(`socket joined: [${room_id}]`);
	});

	socket.on("typing started", (room_id, display_name) => {
		io.to(room_id).emit("typing started", display_name);
	});

	socket.on("typing stopped", (room_id) => {
		io.to(room_id).emit("typing stopped");
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

	// remove friendship
	// TODO: test if it works

	socket.on("remove_friendship", async ({ friend_id, user_id, room_id }) => {
		try {
			await sql.begin(async (sql) => {
				// Remove both sides of the friendship (bidirectional)
				await sql`
				DELETE FROM friends
				WHERE (user_id = ${user_id} AND friend_id = ${friend_id})
			`;

				// Delete the DM room (assuming it's unique to this friendship)
				await sql`
				DELETE FROM rooms
				WHERE id = ${room_id};
			`;

				// Delete room membership for both users
				await sql`
				DELETE FROM room_members
				WHERE room_id = ${room_id} AND user_id IN (${user_id}, ${friend_id});
			`;
			});

			console.log(`✅ Success: remove_friendship`);
		} catch (error) {
			console.error(`❌ Error in remove_friendship:`, error);
		}
	});

	// block friendship
	// TODO: test if it works
	socket.on("block_friendship", async ({ friend_id, user_id, room_id }) => {
		try {
			await sql`
					UPDATE friends
					SET status = 'blocked'
					WHERE user_id = ${user_id} AND friend_id = ${friend_id}
				`;

			console.log(`✅ Success: remove_friendship`);
		} catch (error) {
			console.error(`❌ Error in remove_friendship:`, error);
		}
	});

	socket.on("delete message", async (id, room_id) => {
		try {
			await sql`
					DELETE from messages
					WHERE id = ${id}
				`;
			io.to(room_id).emit("message deleted", id);
			console.log(`✅ Success: delete msg: `, id);
		} catch (error) {
			console.error(`❌ Error in remove_friendship:`, error);
		}
	});

	// send message
	socket.on("message", async ({ room_id, sender_id, sender_image, sender_display_name, content, type = "text" }) => {
		console.log({
			room_id,
			sender_id,
			sender_image,
			sender_display_name,
			content,
			type,
		});

		try {
			await sql.begin(async (sql) => {
				const results = await sql`
					INSERT INTO messages (room_id, sender_id, content, type)
					VALUES (${room_id}, ${sender_id}, ${content}, ${type})
					RETURNING id, created_at
				`;

				const { id, created_at } = results[0];
				console.log("last_msg_id", id);

				await sql`
					UPDATE rooms
					SET last_msg_id = ${id}
					WHERE id = ${room_id}
				`;

				const msg = {
					id,
					sender_id,
					sender_image,
					sender_display_name,
					content,
					type,
					createdAt: created_at,
				};

				io.to(room_id).emit("message", msg);
				console.log("Sent:", msg);
			});
		} catch (error) {
			console.error("insert msg failed", error);
		}
	});

	socket.on("refresh-contacts-page", (currentUser_id, targetUser_id) => {
		io.to(currentUser_id).emit("refresh-contacts-page");
		io.to(targetUser_id).emit("refresh-contacts-page");
		console.log("refresh-contacts-page" , currentUser_id, targetUser_id);
		
	});

	socket.on("leave", (room) => socket.leave(room));


	const userId = socket.handshake.auth?.id;
	if (userId) {
			socket.join(userId);

			// Track socket
			if (!userSockets.has(userId)) userSockets.set(userId, new Set());
			userSockets.get(userId).add(socket);

			const setOnline = async () => {
				// Clear previous timeout
				if (timeoutMap.has(userId)) clearTimeout(timeoutMap.get(userId));
				timeoutMap.delete(userId);

				socket.broadcast.emit("online", userId, true);

				await sql`
      INSERT INTO user_status (user_id, online)
      VALUES (${userId}, TRUE)
      ON CONFLICT (user_id)
      DO UPDATE SET online = TRUE;
    `;

				// Schedule offline if no heartbeat
				const timeout = setTimeout(async () => {
					// Only mark offline if no active sockets
					const sockets = userSockets.get(userId);
					if (!sockets || sockets.size === 0) {
						socket.broadcast.emit("offline", userId, false);
						console.log("set offline", userId);
						await sql`
          UPDATE user_status SET online = FALSE WHERE user_id = ${userId};
        `;
					}
					timeoutMap.delete(userId);
				}, 1000 * 25);

				timeoutMap.set(userId, timeout);
			};

			setOnline();

			socket.on("online", async () => {
				await setOnline();
			});

			socket.on("disconnect", () => {
				const sockets = userSockets.get(userId);
				if (sockets) {
					sockets.delete(socket);
				}
			});	

		}

});



const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
	console.log(`server running at http://localhost:${PORT}`);
});







