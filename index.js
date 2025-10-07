import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import postgres from "postgres";
import "dotenv/config";
import { OpenAI } from "openai";
import console from "node:console";

// const openai = new OpenAI({
// 	baseURL: "https://api.aimlapi.com/v1",
// 	apiKey: process.env["OPENAI_API_KEY"],
// });
const SYSTEM_USER = {
	id: process.env.SYSTEM_USER_ID,
	display_name: process.env.SYSTEM_USER_DISPLAY_NAME,
	email: process.env.SYSTEM_USER_EMAIL,
	image: process.env.SYSTEM_USER_IMAGE,
	created_at: process.env.SYSTEM_USER_CREATED_AT,
	username: process.env.SYSTEM_USER_USERNAME,
};

const client = new OpenAI({
	baseURL: "https://router.huggingface.co/v1",
	apiKey: process.env.HF_API_KEY,
});

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

const userSockets = new Map();
const timeoutMap = new Map();

io.on("connection", (socket) => {
	//=======================================

	socket.on("join", (id) => {
		socket.join(id);
		console.log(`socket joined: ROOM: [${id}]`);
	});

	socket.on("typing started", (room_id, display_name) => {
		io.to(room_id).emit("typing started", display_name);
	});

	socket.on("typing stopped", (room_id, display_name) => {
		io.to(room_id).emit("typing stopped", display_name);
	});

	socket.on("delete message", async (id, room_id) => {
		socket.to(room_id).emit("message deleted", id);
		console.log(`room_id: msg deleted ${room_id}`);
	});

	socket.on("edit message", async (id, room_id, content) => {
		socket.to(room_id).emit("message edited", id, content);
		console.log(`room_id: msg edited ${room_id} content: ${content}`);
	});

	socket.on("add_reaction_msg", (id, user_id, room_id, emoji) => {
		socket.to(room_id).emit("add_reaction_msg", id, user_id, emoji, "add");
		console.log(`room_id: reaction added ${room_id} content: ${emoji}`);
	});

	socket.on("remove_reaction_msg", (id, user_id, room_id, emoji) => {
		socket.to(room_id).emit("remove_reaction_msg", id, user_id, emoji, "remove");
		console.log(`room_id: reaction removed ${room_id} content: ${emoji}`);
	});

	// msg is of type { id: string; room_id: string; sender_id: string  }
	socket.on("message", (msg, callback) => {
		socket.to(msg.room_id).emit("message", msg);

		// // ack to client
		callback();
	});

	// // msg is of type { id: string; room_id: string; sender_id: string  }
	socket.on("system", async ({ msg_content, room_id }, callback) => {
		try {
			callback();

			// ====== OpenAI Responses API reply ======
			try {
				const response = await client.chat.completions.create({
					model: "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B:nscale",
					messages: [
						{
							role: "system",
							content:
								"You are a helpful assistant. Answer the question in 1–2 short sentences. Do not include lengthy reasoning.",
						},
						{ role: "user", content: msg_content },
					],
					temperature: 0.2,
				});

				console.log("AI Response: ", response.choices[0].message);
				const answer = sanitizeForHTML(response.choices[0].message.content) ?? "Sorry, I couldn't generate an answer.";

				// Insert AI reply into DB
				//@ts-ignore
				const aiResults = await sql`
							INSERT INTO messages (room_id, sender_id, content, type)
							VALUES (${room_id}, ${SYSTEM_USER.id}, ${answer}, 'text')
							RETURNING id, created_at
						`;

				const { id: aiId, created_at: aiCreatedAt } = aiResults[0];

				// Send AI message back to the room
				const aiMsg = {
					id: aiId,
					sender_id: SYSTEM_USER.id,
					sender_display_name: SYSTEM_USER.display_name,
					sender_image: SYSTEM_USER.image,
					content: answer,
					type: "text",
					createdAt: aiCreatedAt,
					edited: false,
					reactions: {},
					replyTo: null,
				};

				io.to(room_id).emit("message", aiMsg);
				console.log("AI Sent:", aiMsg);
			} catch (err) {
				console.error(err);
			}
		} catch (error) {
			console.error("insert msg failed", error);
		}
	});

	socket.on("refresh-contacts-page", (currentUser_id, targetUser_id) => {
		// currentUser id is for backward compatability in case current changes do not work
		io.to(targetUser_id).emit("refresh-contacts-page");
		console.log("refresh-contacts-page", currentUser_id, targetUser_id);
	});

	socket.on("leave", (room) => socket.leave(room));

	// not perfect: I've run out of ideas. somethings out of sync with other users on online status
	// const userId = socket.handshake.auth?.id;
	// const username = socket.handshake.auth?.name;
	// if (userId && username) {
	// 	// Track socket
	// 	if (!userSockets.has(userId)) userSockets.set(userId, new Set());
	// 	userSockets.get(userId).add(socket);

	// 	const setOnline = async () => {
	// 		try {
	// 			// Clear previous timeout
	// 			if (timeoutMap.has(userId)) clearTimeout(timeoutMap.get(userId));
	// 			timeoutMap.delete(userId);

	// 			socket.broadcast.emit("online", userId, true);

	// 			await sql`
	// 				INSERT INTO user_status (user_id, online)
	// 				VALUES (${userId}, TRUE)
	// 				ON CONFLICT (user_id)
	// 				DO UPDATE SET online = TRUE;
	// 			`;

	// 			// console.count(`user online: ${username}`);

	// 			// Schedule offline if no heartbeat
	// 			const timeout = setTimeout(async () => {
	// 				// Only mark offline if no active sockets
	// 				const sockets = userSockets.get(userId);
	// 				if (!sockets || sockets.size === 0) {
	// 					socket.broadcast.emit("offline", userId, false);
	// 					console.log("set offline", userId);
	// 					await sql`
	//         UPDATE user_status SET online = FALSE WHERE user_id = ${userId};
	//       `;
	// 				}
	// 				timeoutMap.delete(userId);
	// 			}, 1000 * 25);

	// 			timeoutMap.set(userId, timeout);
	// 		} catch (error) {
	// 			console.error(`Failed to update user ${userId} status`, error);
	// 		}
	// 	};

	// 	setOnline();

	// 	socket.on("online", async () => {
	// 		await setOnline();
	// 	});

	// 	socket.on("disconnect", () => {
	// 		const sockets = userSockets.get(userId);
	// 		if (sockets) {
	// 			sockets.delete(socket);
	// 		}
	// 	});
	// }

	const userSockets = new Map(); // userId -> Set<socket>
	const timeoutMap = new Map(); // userId -> Timeout

	io.on("connection", (socket) => {
		const userId = socket.handshake.auth?.id;
		const username = socket.handshake.auth?.name;

		if (!userId || !username) return;

		// Add socket to user
		if (!userSockets.has(userId)) userSockets.set(userId, new Set());
		userSockets.get(userId).add(socket);

		const clearOfflineTimeout = () => {
			if (timeoutMap.has(userId)) {
				clearTimeout(timeoutMap.get(userId));
				timeoutMap.delete(userId);
			}
		};

		const markOnline = async () => {
			clearOfflineTimeout();

			socket.broadcast.emit("online", userId, true);

			await sql`
      INSERT INTO user_status (user_id, online)
      VALUES (${userId}, TRUE)
      ON CONFLICT (user_id)
      DO UPDATE SET online = TRUE;
    `;
		};

		const markOffline = async () => {
			socket.broadcast.emit("offline", userId, false);
			await sql`UPDATE user_status SET online = FALSE WHERE user_id = ${userId};`;
			console.log("set offline:", userId);
		};

		// When user connects or sends heartbeat
		const handleHeartbeat = async () => {
			await markOnline();

			// Schedule offline after 15 seconds of no heartbeat
			const timeout = setTimeout(async () => {
				const sockets = userSockets.get(userId);
				if (!sockets || sockets.size === 0) {
					await markOffline();
				}
				timeoutMap.delete(userId);
			}, 15 * 1000);

			timeoutMap.set(userId, timeout);
		};

		// --- Initial online ---
		handleHeartbeat();

		// --- Heartbeat event from client ---
		socket.on("online", handleHeartbeat);

		// --- On disconnect ---
		socket.on("disconnect", () => {
			const sockets = userSockets.get(userId);
			if (sockets) {
				sockets.delete(socket);
				if (sockets.size === 0) {
					// No active connections - start countdown to offline
					const timeout = setTimeout(async () => {
						const socketsStill = userSockets.get(userId);
						if (!socketsStill || socketsStill.size === 0) {
							await markOffline();
						}
						timeoutMap.delete(userId);
					}, 22.5 * 1000);
					timeoutMap.set(userId, timeout);
				}
			}
		});
	});

	// ============================================

	let rooms = {};

	socket.on("create-room", (roomId) => {
		// Logic to create a new room
		if (!rooms[roomId]) {
			rooms[roomId] = {
				members: [socket.id],
			};
			// socket.join(roomId);
			socket.emit("room-created", roomId);
			console.log(`Room created: ${roomId}`);
		} else {
			// Room already exists
			socket.emit("room-exists");
		}
	});

	socket.on("join-video-room", (roomId) => {
		// Logic to handle joining an existing room
		const room = rooms[roomId];

		if (!rooms[roomId]) {
			rooms[roomId] = {
				members: [socket.id],
			};
			// socket.join(roomId);
			socket.emit("room-created", roomId);
			console.log(`Room created: ${roomId}`);
		} else if (room && room.members.length == 1) {
			// room.members.push(socket.id);
			// socket.join(roomId);
			console.log("Sending join request to room owner", socket.id);
			io.to(room.members[0]).emit("join-request", socket.id);
		} else {
			// Room is full or does not exist
			socket.emit("room-unavailable");
		}
	});

	socket.on("approve-join-request", (roomId, requesterUserId) => {
		console.log(roomId, requesterUserId);
		const room = rooms[roomId];

		if (room) {
			if (room.members[0] == socket.id) {
				room.members.push(requesterUserId);
				// socket.join(roomId);
				io.to(requesterUserId).emit("join-approved");
				console.log(`User ${requesterUserId} approved to join room ${roomId}`);
				io.to(requesterUserId).emit("start-peer-connection", socket.id);
			}
		}
	});

	socket.on("offer-request", (data) => {
		const { fromOffer, to } = data;
		console.log("Forwarding offer request to: " + to);
		socket.to(to).emit("offer-request", { from: socket.id, offer: fromOffer });
	});

	socket.on("offer-answer", (data) => {
		const { answere, to } = data;
		console.log("Forwarding offer answer to: " + to);
		socket.to(to).emit("offer-answer", { from: socket.id, offer: answere });
	});

	socket.on("peer-updated", (data) => {
		const { candidate, to } = data;
		console.log("Peer updated");
		socket.to(to).emit("peer-updated", { from: socket.id, candidate: candidate });
	});

	socket.on("call-ended", (targetSocketId) => {
		// Notify the other peer that the call ended
		socket.to(targetSocketId).emit("call-ended");
	});
});

const PORT = process.env.PORT || 8000;

server.listen(PORT, () => {
	if (process.env.NODE_ENV === "production") {
		console.log(`✅ Server running in production on port ${PORT}`);
	} else {
		console.log(`🚀 Server running locally at http://localhost:${PORT}`);
	}
});




function sanitizeForHTML(input) {
	return input.replace(/\r?\n|\r/g, " "); // Replace line breaks with space
}
