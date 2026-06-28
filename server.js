const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const INITIAL_STATE = {
    status: "lobby", 
    currentQuestionIndex: 0,
    timerStart: null,
    duration: 20
};

let quizState = { ...INITIAL_STATE };
let players = {}; 
let socketToPlayer = {}; 
let answers = {}; 
let serverTimerTimeout = null;

// LE 11 DOMANDE REALI DI SILVIA & GIORGIO (3 Opzioni per domanda)
const questions = [
    { 
        id: 0, 
        text: "1) Il debutto gastronomico: cosa hanno mangiato alla loro prima cena a Milano?", 
        options: ["Del pesce avariato", "Un hamburger congelato", "Solo patatine fritte"], 
        correct: "1" 
    },
    { 
        id: 1, 
        text: "2) Cosa ha reso famosi i festeggiati nel 2016?", 
        options: ["Un video del Milanese Imbruttito alla Design Week", "Un’apparizione nel video di Coez", "Una manifestazione in Duomo"], 
        correct: "0" 
    },
    { 
        id: 2, 
        text: "3) Chi ha colonizzato Milano per primo?", 
        options: ["Silvia", "Giorgio", "Nessuno, sono arrivati insieme"], 
        correct: "1" 
    },
    { 
        id: 3, 
        text: "4) In che giorno si sono battezzati?", 
        options: ["20 ottobre 1996", "25 dicembre 1996", "30 settembre 1996"], 
        correct: "2" 
    },
    { 
        id: 4, 
        text: "5) Chi dei due ha l'ego (e l'oroscopo) dominante ed è Ascendente Leone?", 
        options: ["Giorgio (il re della savana... o del divano).", "Silvia (chioma leonina e manie di controllo).", "Nessun cuor di leone"], 
        correct: "1" 
    },
    { 
        id: 5, 
        text: "6) Quale sport estremo e logorante hanno praticato entrambi?", 
        options: ["Calcio", "Atletica", "Pallavolo"], 
        correct: "1" 
    },
    { 
        id: 6, 
        text: "7) Il fatidico primo incontro: dove si sono incrociati i loro destini?", 
        options: ["A catechismo", "Tra i banchi di scuola", "Facendo sport"], 
        correct: "0" 
    },
    { 
        id: 7, 
        text: "8) Quanti anni di \"condanna\" hanno passato nella stessa identica classe?", 
        options: ["5 anni", "3 anni", "10 anni"], 
        correct: "1" 
    },
    { 
        id: 8, 
        text: "9) Chi soffre della sindrome dello studente eterno e ha più lauree?", 
        options: ["Silvia", "Giorgio", "Sono pari"], 
        correct: "1" 
    },
    { 
        id: 9, 
        text: "10) Durante l’ultimo viaggio insieme cosa ha causato il litigio più memorabile?", 
        options: ["Google maps che ha indicato la strada sbagliata", "La scelta del ristorante in cui pranzare", "La ripartizione dei costi sostenuti"], 
        correct: "1" 
    },
    { 
        id: 10, 
        text: "11) Chi è la mente geniale (e modesta) dietro questo quiz divertentissimo?", 
        options: ["Giorgio", "Silvia", "Mario"], 
        correct: "1" 
    }
];

function calculateStats() {
    let stats = [0, 0, 0, 0]; 
    let correctCount = 0;
    
    if (!questions[quizState.currentQuestionIndex]) return { stats, correctCount };
    const currentQuestion = questions[quizState.currentQuestionIndex];

    Object.values(answers).forEach(ans => {
        if (ans >= 0 && ans <= 3) stats[ans]++;
        if (String(ans) === currentQuestion.correct) correctCount++;
    });
    return { stats, correctCount };
}

function setQuizStatus(newStatus) {
    quizState.status = newStatus;
    clearTimeout(serverTimerTimeout);

    if (newStatus === "question") {
        answers = {}; 
        quizState.timerStart = Date.now();
        serverTimerTimeout = setTimeout(() => { setQuizStatus("results"); }, quizState.duration * 1000);
    }
    sendStateToAll();
}

function sendStateToAll() {
    try {
        const { stats, correctCount } = calculateStats();
        const nextQuestion = questions[quizState.currentQuestionIndex + 1] || null;

        io.emit('state-updated', {
            quizState,
            currentQuestion: questions[quizState.currentQuestionIndex],
            totalQuestions: questions.length, // Mandiamo il totale a tutti
            nextQuestionPreview: nextQuestion ? nextQuestion.text : "Fine del Quiz!",
            players,
            stats,
            correctCount,
            answersCount: Object.keys(answers).length,
            isFinal: quizState.currentQuestionIndex === questions.length - 1 && quizState.status === "leaderboard"
        });
    } catch (e) {
        console.error("Errore nell'invio dello stato:", e);
    }
}

io.on('connection', (socket) => {
    socket.emit('init-state', { 
        quizState, 
        currentQuestion: questions[quizState.currentQuestionIndex], 
        totalQuestions: questions.length,
        playersCount: Object.keys(players).length,
        answersCount: Object.keys(answers).length,
        players: players,
        stats: calculateStats().stats
    });

    socket.on('join-game', ({ name, table }) => {
        const pId = socket.id; 
        players[pId] = { name, table, score: 0, socketId: socket.id };
        socketToPlayer[socket.id] = pId;
        
        io.emit('players-count', Object.keys(players).length);
        socket.emit('join-success');
        sendStateToAll();
    });

    socket.on('submit-answer', ({ answerIndex, timeTaken }) => {
        const pId = socketToPlayer[socket.id];
        if (!pId || quizState.status !== "question") return;
        
        if (answers[pId] === undefined) {
            answers[pId] = answerIndex;
            const validTime = Math.min(quizState.duration, Math.max(0, Number(timeTaken) || quizState.duration));
            const currentQuestion = questions[quizState.currentQuestionIndex];
            
            if (String(answerIndex) === currentQuestion.correct) {
                const speedBonus = Math.max(0, Math.round((quizState.duration - validTime) * (50 / quizState.duration)));
                players[pId].score += (100 + speedBonus);
            }
            
            const { stats } = calculateStats();
            io.emit('answers-updated', { answersCount: Object.keys(answers).length, stats: stats });
        }
    });

    socket.on('host-set-status', (newStatus) => setQuizStatus(newStatus));

    socket.on('host-next-question', () => {
        if (quizState.currentQuestionIndex < questions.length - 1) {
            quizState.currentQuestionIndex++;
            setQuizStatus("question");
        } else {
            setQuizStatus("leaderboard");
        }
    });

    socket.on('host-prev-question', () => {
        if (quizState.currentQuestionIndex > 0) {
            quizState.currentQuestionIndex--;
            setQuizStatus("question");
        }
    });

    socket.on('host-reset-quiz', () => {
        clearTimeout(serverTimerTimeout);
        quizState = { ...INITIAL_STATE };
        quizState.status = "lobby";
        quizState.currentQuestionIndex = 0;
        players = {}; 
        socketToPlayer = {}; 
        answers = {}; 
        io.emit('quiz-reset-triggered');
        io.emit('players-count', 0);
        sendStateToAll();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server attivo sulla porta " + PORT));
