import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, Send, Sparkles, VolumeX, Volume2, Bell, AlertCircle } from "lucide-react";
import { sound } from "../utils/audio";

interface ChatMessage {
  user: string;
  text: string;
  time: string;
  isPing?: boolean;
}

interface LiveChatProps {
  username: string;
  onInspectUser?: (username: string) => void;
}

export const LiveChat: React.FC<LiveChatProps> = ({ username, onInspectUser }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [mutedUsers, setMutedUsers] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem("dt_muted_chat_users");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [lastPingTime, setLastPingTime] = useState<number>(0);
  const endRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Sync muted users to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem("dt_muted_chat_users", JSON.stringify(mutedUsers));
    } catch {}
  }, [mutedUsers]);

  const toggleMuteUser = (userToMute: string) => {
    sound.playButtonClick();
    setMutedUsers((prev) =>
      prev.includes(userToMute) ? prev.filter((u) => u !== userToMute) : [...prev, userToMute]
    );
  };

  useEffect(() => {
    // Initial fetch of chat history
    const fetchChat = async () => {
      try {
        const res = await fetch("/api/chat/messages");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setMessages(data);
          }
        }
      } catch (e) {
        // quiet fallback
      }
    };

    fetchChat();
    const pollInterval = setInterval(fetchChat, 2000);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(`${protocol}//${window.location.host}`);
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "CHAT_MESSAGE") {
            if (data.isPing) {
              sound.playChip();
            }
            setMessages((prev) => {
              if (prev.some((m) => m.time === data.time && m.user === data.user && m.text === data.text)) {
                return prev;
              }
              return [...prev.slice(-60), data];
            });
          }
        } catch (e) {
          console.error(e);
        }
      };
      setWs(socket);
    } catch {
      // ws unsupported or blocked
    }

    return () => {
      clearInterval(pollInterval);
      if (socket) socket.close();
    };
  }, []);

  // Auto-scroll behavior to always keep newest message in view
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handlePingTable = async () => {
    const now = Date.now();
    if (now - lastPingTime < 10000) {
      return; // 10s cooldown
    }
    setLastPingTime(now);
    sound.playChip();

    const pingMsg: ChatMessage = {
      user: username,
      text: "⚡ PING! Ready for real action? Place your bets or challenge me 1v1!",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      isPing: true,
    };

    setMessages((prev) => [...prev, pingMsg]);

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "CHAT", ...pingMsg }));
      } catch {}
    }

    try {
      await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pingMsg),
      });
    } catch {}
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const trimmed = inputText.trim();
    const newMsg: ChatMessage = {
      user: username,
      text: trimmed,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    // Optimistic UI update
    setMessages((prev) => [...prev, newMsg]);
    setInputText("");

    // 1. Send via WebSocket if open
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "CHAT", ...newMsg }));
      } catch (e) {
        console.error(e);
      }
    }

    // 2. Dual send via REST API to persist in server and broadcast to all HTTP-polling players
    try {
      await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMsg),
      });
    } catch (e) {
      console.error("Failed to push chat via REST", e);
    }
  };

  const visibleMessages = messages.filter((m) => !mutedUsers.includes(m.user));

  return (
    <div className="bg-neutral-950 border border-neutral-800 rounded-2xl flex flex-col h-[380px] overflow-hidden">
      {/* Header */}
      <div className="px-3 sm:px-4 py-2.5 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/50">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">Live Player Lounge</span>
          {mutedUsers.length > 0 && (
            <span
              onClick={() => setMutedUsers([])}
              className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 cursor-pointer hover:bg-red-500/30"
              title="Click to unmute all"
            >
              Muted ({mutedUsers.length}) ✕
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Ping Button */}
          <button
            type="button"
            onClick={handlePingTable}
            title="Ping players at the table with sound alert"
            disabled={Date.now() - lastPingTime < 10000}
            className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
          >
            <Bell className="w-3 h-3 text-amber-400 animate-bounce" />
            <span>Ping Table</span>
          </button>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-medium">
            Live
          </span>
        </div>
      </div>

      {/* Messages */}
      <div ref={chatContainerRef} className="flex-1 p-3 overflow-y-auto space-y-2 text-xs">
        {visibleMessages.length === 0 ? (
          <div className="text-center py-8 text-neutral-500 text-xs">
            No messages yet. Say hello or challenge someone to a duel!
          </div>
        ) : (
          visibleMessages.map((m, idx) => {
            const isSelf = m.user === username;
            return (
              <div
                key={idx}
                className={`p-2 rounded-xl border transition-all ${
                  m.isPing
                    ? "bg-amber-950/40 border-amber-500/50 shadow-sm"
                    : "bg-neutral-900/60 border-neutral-800/80"
                }`}
              >
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => onInspectUser && onInspectUser(m.user)}
                      className="font-bold text-amber-300 hover:text-amber-200 hover:underline cursor-pointer transition-colors text-left"
                      title="View player profile"
                    >
                      {m.user}
                    </button>
                    {!isSelf && (
                      <button
                        type="button"
                        onClick={() => toggleMuteUser(m.user)}
                        className="text-neutral-500 hover:text-red-400 p-0.5 rounded transition-colors cursor-pointer"
                        title={`Mute messages from ${m.user}`}
                      >
                        <VolumeX className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <span className="text-neutral-500 text-[10px]">{m.time}</span>
                </div>
                <p className={`break-words ${m.isPing ? "text-amber-200 font-bold" : "text-neutral-300"}`}>
                  {m.text}
                </p>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSendMessage} className="p-2 border-t border-neutral-800 bg-neutral-900/50 flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Send message to table..."
          maxLength={120}
          className="flex-1 bg-neutral-950 border border-neutral-800 focus:border-amber-500 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center cursor-pointer active:scale-95"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
};
