import React, { useState, useEffect, useRef } from 'react';
import { IMessage } from '../../types';
import { api } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { MessageSquare, Send, X } from 'lucide-react';

interface ChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  rideId: string | null;
  currentUserId: string;
}

export const ChatModal: React.FC<ChatModalProps> = ({
  isOpen,
  onClose,
  rideId,
  currentUserId,
}) => {
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [inputContent, setInputContent] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Fetch messages from DB
  useEffect(() => {
    if (!isOpen || !rideId) return;

    const fetchMessages = async () => {
      try {
        const res = await api.get<IMessage[]>(`/chat/${rideId}`);
        setMessages(res || []);
        scrollToBottom();
      } catch (err) {
        console.error('Fetch chat error:', err);
      }
    };

    fetchMessages();

    // Socket real-time message receiver
    const socket = getSocket();
    const handleNewMessage = (msg: IMessage) => {
      if (msg.rideId === rideId) {
        setMessages((prev) => [...prev, msg]);
        scrollToBottom();
      }
    };

    socket.on('chat:message_received', handleNewMessage);

    return () => {
      socket.off('chat:message_received', handleNewMessage);
    };
  }, [isOpen, rideId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputContent.trim() || !rideId) return;

    const socket = getSocket();
    socket.emit('chat:send_message', {
      rideId,
      content: inputContent.trim(),
    });

    setInputContent('');
  };

  if (!isOpen || !rideId) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md h-[550px] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-200 text-right">
        {/* Header */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-emerald-600 flex items-center justify-center">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm">محادثة الرحلة المباشرة</h3>
              <p className="text-[11px] text-emerald-400 font-mono">رحلة #{rideId.slice(-6)}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Messages Body */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-xs text-slate-400 space-y-1">
              <MessageSquare className="h-8 w-8 text-slate-300" />
              <p>ابدأ المحادثة مع الطرف الآخر للتنسيق بخصوص الرحلة.</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.senderId === currentUserId;
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className="text-[10px] text-slate-400 px-1 mb-0.5">
                    {msg.senderName}
                  </div>
                  <div
                    className={`max-w-[80%] p-3 rounded-2xl text-xs font-medium ${
                      isMe
                        ? 'bg-emerald-600 text-white rounded-br-xs shadow-xs'
                        : 'bg-white text-slate-900 rounded-bl-xs border border-slate-200 shadow-xs'
                    }`}
                  >
                    {msg.content}
                  </div>
                  <span className="text-[9px] text-slate-400 px-1 mt-0.5 font-mono">
                    {new Date(msg.createdAt).toLocaleTimeString('ar-SA', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-slate-200 flex gap-2">
          <input
            type="text"
            value={inputContent}
            onChange={(e) => setInputContent(e.target.value)}
            placeholder="اكتب رسالتك هنا..."
            className="flex-1 text-xs p-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
          />
          <button
            type="submit"
            className="h-11 w-11 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center transition-colors shadow-md shadow-emerald-600/30 shrink-0"
          >
            <Send className="h-4 w-4 rotate-180" />
          </button>
        </form>
      </div>
    </div>
  );
};
