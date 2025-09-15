// Importa os módulos necessários da nova forma (V2)
const {onCall} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const mercadopago = require("mercadopago");
const functions = require("firebase-functions");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");

// Inicializa a aplicação
initializeApp();
const db = getFirestore();

// --- FUNÇÃO PARA APROVAR PARCEIROS (SINTAXE V2) ---
exports.approvePartner = onCall({region: "southamerica-east1"}, async (request) => {
    // Verificações de segurança
    if (!request.auth || request.auth.token.email !== "suaviagemaqui.adm@gmail.com") {
        throw new functions.https.HttpsError('permission-denied', 'Você não tem permissão.');
    }
    const partnerUid = request.data.partnerUid;
    if (!partnerUid) {
        throw new functions.https.HttpsError('invalid-argument', 'O UID do parceiro é necessário.');
    }

    // Gerar ID único
    let partnerId;
    let isUnique = false;
    while (!isUnique) {
        const randomId = Math.floor(100000 + Math.random() * 900000).toString();
        const snapshot = await db.collection('partners').where('partnerId', '==', randomId).get();
        if (snapshot.empty) {
            partnerId = randomId;
            isUnique = true;
        }
    }

    // Atualizar documento
    try {
        const partnerDocRef = db.collection('partners').doc(partnerUid);
        await partnerDocRef.update({
            status: 'aprovado',
            partnerId: partnerId,
            approvedAt: FieldValue.serverTimestamp()
        });

        // Enviar notificação para o Telegram
        const TelegramBot = require('node-telegram-bot-api'); // Import here
        const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false }); // Initialize here
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
        const message = `Novo anúncio aprovado! ID do Parceiro: ${partnerId}`;
        await bot.sendMessage(adminChatId, message);

        return { success: true, message: `Parceiro aprovado! ID: ${partnerId}` };
    } catch (error) {
        console.error("Erro ao aprovar parceiro:", error);
        throw new functions.https.HttpsError('internal', 'Erro ao atualizar os dados.');
    }
});

// --- FUNÇÃO PARA NOTIFICAR ADMIN SOBRE NOVO USUÁRIO QUE QUER ENTRAR NO GRUPO TELEGRAM ---
exports.notifyAdminNewUserTelegram = onDocumentCreated("users/{userId}", async (event) => {
    const userData = event.data.data();
    const userId = event.params.userId;

    // Verifica se o usuário aceitou fazer parte do grupo do Telegram
    if (userData.joinTelegramGroup) {
        const TelegramBot = require('node-telegram-bot-api');
        const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: false });
        const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

        try {
            const message = `Novo viajante ${userData.fullName} (${userData.email}) aceitou fazer parte do grupo do Telegram. Contato: ${userData.whatsapp || 'N/A'} / ${userData.telegram || 'N/A'}. Por favor, adicione-o manualmente.`;
            await bot.sendMessage(adminChatId, message);
            console.log(`Admin notificado sobre novo usuário para grupo Telegram: ${userData.email}`);
        } catch (error) {
            console.error("Erro ao notificar admin sobre novo usuário Telegram:", error);
        }
    }
});

// --- FUNÇÃO PARA CRIAR PREFERÊNCIA DE PAGAMENTO (SINTAXE V2) ---
exports.criarPreferenciaDePagamento = onCall({region: "southamerica-east1"}, async (request) => {
    // Configura o Mercado Pago com a sua chave secreta (MOVED HERE)
    mercadopago.configure({
        access_token: process.env.MERCADOPAGO_TOKEN
    });

    const { title, price } = request.data;

    const preference = {
        items: [{
            title: title,
            unit_price: price,
            quantity: 1,
        }],
        back_urls: {
            success: "https://suaviagemaqui.com.br/pagamento-sucesso",
            failure: "https://suaviagemaqui.com.br/pagamento-falha",
            pending: "https://suaviagemaqui.com.br/pagamento-pendente"
        },
        auto_return: "approved",
    };

    try {
        const response = await mercadopago.preferences.create(preference);
        return { preferenceId: response.body.id };
    } catch (error) {
        console.error("Erro ao criar preferência no Mercado Pago:", error);
        throw new functions.https.HttpsError('internal', 'Não foi possível criar a preferência de pagamento.');
    }
});

exports.applyGuidePromotion = onDocumentCreated("users/{userId}", async (event) => {
    const userData = event.data.data();
    const userId = event.params.userId;

    // Check if the new user is a guide
    if (userData.category === 'guias') {
        const promoRef = db.doc('promotions/guides_promo');
        const userRef = db.doc(`users/${userId}`);

        try {
            await db.runTransaction(async (transaction) => {
                const promoDoc = await transaction.get(promoRef);

                let count = 0;
                if (promoDoc.exists) {
                    count = promoDoc.data().count;
                }

                if (count < 25) {
                    // Increment the counter
                    transaction.set(promoRef, { count: count + 1 }, { merge: true });

                    // Apply the promotion to the user
                    const promotionEndDate = new Date();
                    promotionEndDate.setMonth(promotionEndDate.getMonth() + 2);
                    transaction.update(userRef, { 
                        promotionEndDate: promotionEndDate,
                        plan: 'basic' // Set the plan to basic
                    });
                }
            });
            console.log(`Promotion applied to guide ${userId}`);
        } catch (error) {
            console.error("Erro ao aplicar promoção:", error);
        }
    }
});

exports.getPlatformMetrics = onCall({region: "southamerica-east1"}, async (request) => {
    // Security check: Only allow admins to call this function
    if (!request.auth || !(request.auth.token.email === "suaviagemaqui.adm@gmail.com" || request.auth.token.admin === true)) {
        throw new functions.https.HttpsError('permission-denied', 'Você não tem permissão para acessar estas métricas.');
    }

    const metrics = {
        totalUsers: 0,
        travelersFree: 0,
        travelersPlus: 0,
        advertisers: 0,
        guides: 0,
        admins: 0,
        activeAds: 0,
        activeEvents: 0
    };

    // Get user counts
    const usersSnapshot = await db.collection('users').get();
    metrics.totalUsers = usersSnapshot.size;
    usersSnapshot.forEach(doc => {
        const userData = doc.data();
        if (userData.accountType === 'viajante-free') {
            metrics.travelersFree++;
        } else if (userData.accountType === 'viajante-plus') {
            metrics.travelersPlus++;
        } else if (userData.accountType === 'anunciante') {
            metrics.advertisers++;
        } else if (userData.category === 'guias') { // Guides are also advertisers, but we count them separately if they have 'guias' category
            metrics.guides++;
        } else if (userData.accountType === 'admin') {
            metrics.admins++;
        }
    });

    // Get active ads count
    const partnersSnapshot = await db.collection('partners').where('status', '==', 'aprovado').get();
    metrics.activeAds = partnersSnapshot.size;

    // Get active events count (assuming an 'events' collection exists)
    const eventsSnapshot = await db.collection('events').get(); // Assuming all events are active for now
    metrics.activeEvents = eventsSnapshot.size;

    return metrics;
});