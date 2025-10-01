import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";
import postgres from "postgres";
import "dotenv/config";

import { OpenAI } from "openai";

const openai = new OpenAI({
	baseURL: "https://api.aimlapi.com/v1",
	apiKey: process.env["OPENAI_API_KEY"],
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

	socket.on("typing stopped", (room_id) => {
		io.to(room_id).emit("typing stopped");
	});

	socket.on("create_dm", async ({}) => {});

	socket.on("delete message", async (id, room_id) => {
		io.to(room_id).emit("message deleted", id);
		console.log(`room_id: msg deleted ${room_id}`);
	});

	socket.on("edit message", async (id, room_id, content) => {
		io.to(room_id).emit("message edited", id, content);
		console.log(`room_id: msg edited ${room_id} content: ${content}`);
	});

	socket.on("add_reaction_msg", (id, user_id, room_id, emoji) => {
		io.to(room_id).emit("add_reaction_msg", id, user_id, emoji, "add");
		console.log(`room_id: reaction added ${room_id} content: ${emoji}`);
	});

	socket.on("remove_reaction_msg", (id, user_id, room_id, emoji) => {
		io.to(room_id).emit("remove_reaction_msg", id, user_id, emoji, "remove");
		console.log(`room_id: reaction removed ${room_id} content: ${emoji}`);
	});

	// msg is of type { id: string; room_id: string; sender_id: string  }
	socket.on("message", (msg, callback) => {
	socket.on("message", (msg, callback) => {
		io.to(msg.room_id).emit("message", msg);

		// // ack to client
		callback();

		// callback({ status: "ok", type: "user", receivedAt: Date.now(), msg: msg.content });

		// console.log("Sent Chat:", msg);

		// // ack to client
		callback();

		// callback({ status: "ok", type: "user", receivedAt: Date.now(), msg: msg.content });

		// console.log("Sent Chat:", msg);
	});

	// msg is of type { id: string; room_id: string; sender_id: string  }
	socket.on("system", async (msg, callback) => {
	socket.on("system", async (msg, callback) => {
		try {
			io.to(msg.room_id).emit("message", msg);
			// // ack to client
			callback();

			// callback({ status: "ok", type: "system", receivedAt: Date.now(), msg: msg.content });
			// console.log("Sent system:", msg);
			// // ack to client
			callback();

			// callback({ status: "ok", type: "system", receivedAt: Date.now(), msg: msg.content });
			// console.log("Sent system:", msg);

			// ====== OpenAI Responses API reply ======
			try {
				// const aiResponse = await openai.chat.completions.create({
				// 	model: "gpt-4o-mini-2024-07-18",
				// 	messages: [
				// 		{ role: "system", content: "You are a helpful AI assistant." },
				// 		{ role: "user", content },
				// 	],
				// 	temperature: 0.7,
				// 	top_p: 0.7,
				// 	frequency_penalty: 1,
				// 	max_tokens: 1536,
				// 	top_k: 50,
				// });
				const aiText =
					// aiResponse?.choices[0].message.content ||
					"Sorry, I couldn't generate a response.";
				console.log(`Assistant: ${aiText}`);

				// Insert AI reply into DB
				const aiResults = await sql`
							INSERT INTO messages (room_id, sender_id, content, type)
							VALUES (${msg.room_id}, 'system', ${aiText}, 'text')
							RETURNING id, created_at
						`;

				const { id: aiId, created_at: aiCreatedAt } = aiResults[0];

				// Send AI message back to the room
				const aiMsg = {
					id: aiId,
					sender_id: "system",
					sender_image: "https://ydcbbjaovlxvvoecbblp.supabase.co/storage/v1/object/public/uploads/system.png",
					sender_display_name: "AI BOT",
					content: aiText,
					type: "text",
					createdAt: aiCreatedAt,
				};

				io.to(msg.room_id).emit("message", aiMsg);
				console.log("AI Sent:", aiMsg);
			} catch (err) {
				console.error("OpenAI error:", err);

				// @ts-ignore
				if (err.code === "insufficient_quota" || err.status === 429) {
					console.warn("OpenAI quota exceeded. Sending fallback message.");
					io.to(msg.room_id).emit("message", {
						id: "system-fallback-" + Date.now(),
						sender_id: "system",
						sender_display_name: "AI BOT",
						sender_image: "https://ydcbbjaovlxvvoecbblp.supabase.co/storage/v1/object/public/uploads/system.png",
						content:
							"AI reply unavailable (quota exceeded). [Sorry, I have not found new models that offer free tiers]",
						type: "text",
						createdAt: new Date().toISOString(),
					});
				}
			}
		} catch (error) {
			console.error("insert msg failed", error);
		}
	});

	socket.on("refresh-contacts-page", (currentUser_id, targetUser_id) => {
		io.to(currentUser_id).emit("refresh-contacts-page");
		io.to(targetUser_id).emit("refresh-contacts-page");
		console.log("refresh-contacts-page", currentUser_id, targetUser_id);
	});

	socket.on("leave", (room) => socket.leave(room));

	// not perfect: I've run out of ideas. somethings out of sync with other users on online status
	const userId = socket.handshake.auth?.id;
	if (userId) {
		// Track socket
		if (!userSockets.has(userId)) userSockets.set(userId, new Set());
		userSockets.get(userId).add(socket);

		const setOnline = async () => {
			try {
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
			} catch (error) {
				console.error(`Failed to update user ${userId} status`, error);
			}
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
	if (process.env.NODE_ENV === "production") {
		console.log(`✅ Server running in production on port ${PORT}`);
	} else {
		console.log(`🚀 Server running locally at http://localhost:${PORT}`);
	}
});
