// Importa os módulos necessários da nova forma (V2)
const {onCall} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const mercadopago = require("mercadopago");
const functions = require("firebase-functions");

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
        const bot = new TelegramBot(functions.config().telegram.token, { polling: false }); // Initialize here
        const adminChatId = functions.config().telegram.admin_chat_id;
        const message = `Novo anúncio aprovado! ID do Parceiro: ${partnerId}`;
        await bot.sendMessage(adminChatId, message);

        return { success: true, message: `Parceiro aprovado! ID: ${partnerId}` };
    } catch (error) {
        console.error("Erro ao aprovar parceiro:", error);
        throw new functions.https.HttpsError('internal', 'Erro ao atualizar os dados.');
    }
});

// --- FUNÇÃO PARA CRIAR PREFERÊNCIA DE PAGAMENTO (SINTAXE V2) ---
exports.criarPreferenciaDePagamento = onCall({region: "southamerica-east1"}, async (request) => {
    // Configura o Mercado Pago com a sua chave secreta (MOVED HERE)
    mercadopago.configure({
        access_token: functions.config().mercadopago.token
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