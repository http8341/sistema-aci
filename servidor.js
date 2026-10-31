const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const archiver = require('archiver');
const fetch = require('node-fetch');

const app = express();
const PORTA = process.env.PORT || 3000;
const PERCENTUAL_ADMIN = 5;

// ======================================
// ⚙️ CONFIGURAÇÕES — PRONTAS PARA RENDER
// ======================================
const AMBIENTE = process.env.NODE_ENV || 'development';
const BASE_URL = '/aci';

const ENDERECO_SERVIDOR = process.env.RENDER_EXTERNAL_URL
  ? `${process.env.RENDER_EXTERNAL_URL}${BASE_URL}`
  : `http://localhost:${PORTA}${BASE_URL}`;

const IP_PDV_PADRAO = "";
const LINK_VITRINE_PUBLICO = ENDERECO_SERVIDOR + "/vitrine";
const PROTEGER_ROTAS = false;
const SENHA_ADMIN = "8341@";
const FAZER_BACKUP_AUTOMATICO = true;

const statusLojas = {};

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ======================================
// 📂 CAMINHOS DAS PASTAS
// ======================================
const pastaRaiz = __dirname;
const pastaDados = path.join(pastaRaiz, 'dados');
const pastaLojas = path.join(pastaDados, 'lojas');
const pastaRelatorios = path.join(pastaDados, 'relatorios');
const pastaEntregas = path.join(pastaRelatorios, 'entregas');
const pastaConfig = path.join(pastaDados, 'config');
const pastaCodigosGerados = path.join(pastaDados, 'codigos_gerados');
const pastaBackups = path.join(pastaDados, 'backups');
const pastaUploads = path.join(pastaRaiz, 'uploads_cnh');
const pastaFotosTemp = path.join(pastaRaiz, 'fotos_temp');
const pastaModelos = path.join(pastaRaiz, 'public');

console.log('========================================');
console.log('🚀 INICIANDO SISTEMA ACI — RENDER');
console.log('========================================');
console.log('📂 PASTA RAIZ:', pastaRaiz);
console.log('📂 PASTA DADOS:', pastaDados);
console.log('🌐 SERVIDOR:', ENDERECO_SERVIDOR);
console.log('📦 AMBIENTE:', AMBIENTE);
console.log('========================================');

const arquivoEntregadores = path.join(pastaConfig, 'entregadores.json');
const arquivoCadastrosPendentes = path.join(pastaConfig, 'cadastros_pendentes.json');
const arquivoRegistroLojas = path.join(pastaConfig, 'registro_lojas.json');

// ======================================
// 📤 CONFIGURAÇÃO DE UPLOAD
// ======================================
const armazenamento = multer.diskStorage({
  destination: (req, file, cb) => cb(null, pastaUploads),
  filename: (req, file, cb) => {
    const nomeSeguro = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, nomeSeguro);
  }
});

const upload = multer({
  storage: armazenamento,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitidos = /jpeg|jpg|png|webp/;
    const ext = permitidos.test(path.extname(file.originalname).toLowerCase());
    const mime = permitidos.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Apenas imagens (JPG, PNG, WEBP) são permitidas'));
  }
});

// ✅ LIBERA ACESSO PÚBLICO
app.use(`${BASE_URL}/config`, express.static(pastaConfig, { index: false }));
app.use(`${BASE_URL}/uploads_cnh`, express.static(pastaUploads));
app.use(`${BASE_URL}`, express.static(pastaModelos));

// ======================================
// 📁 CRIAR PASTAS AUTOMATICAMENTE
// ======================================
[pastaDados, pastaConfig, pastaLojas, pastaRelatorios, pastaEntregas,
 pastaCodigosGerados, pastaBackups, pastaUploads, pastaFotosTemp, pastaModelos].forEach(pasta => {
  if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
});

// Criar arquivos padrão
if (!fs.existsSync(arquivoRegistroLojas)) {
  fs.writeFileSync(arquivoRegistroLojas, JSON.stringify({
    descricao: "Registro de lojas cadastradas",
    versao: "1.0",
    lojas: []
  }, null, 2), "utf8");
}
if (!fs.existsSync(arquivoCadastrosPendentes)) {
  fs.writeFileSync(arquivoCadastrosPendentes, JSON.stringify([], null, 2), "utf8");
}
if (!fs.existsSync(arquivoEntregadores)) {
  fs.writeFileSync(arquivoEntregadores, JSON.stringify([], null, 2), "utf8");
}

// ======================================
// 🛡️ FUNÇÕES AUXILIARES
// ======================================
function salvarDadosSeguro(caminho, dados) {
  try {
    const temp = `${caminho}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(dados, null, 2), 'utf8');
    fs.renameSync(temp, caminho);
    return true;
  } catch (erro) {
    if (fs.existsSync(`${caminho}.tmp`)) fs.unlinkSync(`${caminho}.tmp`);
    console.error(`❌ Erro ao salvar ${caminho}:`, erro.message);
    return false;
  }
}

function fazerBackup() {
  if (!FAZER_BACKUP_AUTOMATICO) return;
  try {
    const data = new Date().toISOString().slice(0,19).replace(/[:T]/g, '-');
    const camZip = path.join(pastaBackups, `backup-${data}.zip`);
    const saida = fs.createWriteStream(camZip);
    const zip = archiver('zip', { zlib: { level: 6 } });
    saida.on('close', () => console.log(`💾 Backup salvo: ${camZip}`));
    zip.on('error', err => console.warn(`⚠️ Falha no backup:`, err.message));
    zip.pipe(saida);
    if (fs.existsSync(pastaLojas)) zip.directory(pastaLojas, 'lojas');
    if (fs.existsSync(pastaConfig)) zip.directory(pastaConfig, 'config');
    if (fs.existsSync(pastaRelatorios)) zip.directory(pastaRelatorios, 'relatorios');
    zip.finalize();
  } catch (erro) {
    console.warn(`⚠️ Falha no backup:`, erro.message);
  }
}

function normalizarTexto(texto) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/ /g, "_");
}

function carregarEntregadores() {
  try {
    if (!fs.existsSync(arquivoEntregadores)) return [];
    const conteudo = fs.readFileSync(arquivoEntregadores, 'utf8').trim();
    return conteudo ? JSON.parse(conteudo) : [];
  } catch (erro) {
    console.warn("⚠️ Arquivo entregadores.json inválido:", erro.message);
    return [];
  }
}
function salvarEntregadores(lista) { return salvarDadosSeguro(arquivoEntregadores, lista) }

function carregarPendentes() {
  try {
    if (!fs.existsSync(arquivoCadastrosPendentes)) return [];
    const conteudo = fs.readFileSync(arquivoCadastrosPendentes, 'utf8').trim();
    return conteudo ? JSON.parse(conteudo) : [];
  } catch (erro) {
    console.warn("⚠️ Arquivo cadastros_pendentes.json inválido:", erro.message);
    return [];
  }
}
function salvarPendentes(lista) { return salvarDadosSeguro(arquivoCadastrosPendentes, lista) }

function carregarRegistroLojas() {
  try {
    if (!fs.existsSync(arquivoRegistroLojas)) return [];
    const dados = JSON.parse(fs.readFileSync(arquivoRegistroLojas, 'utf8'));
    return dados.lojas || [];
  } catch { return []; }
}
function salvarRegistroLojas(listaAtualizada) {
  const dadosCompletos = {
    descricao: "Registro oficial de lojas cadastradas",
    versao: "1.0",
    lojas: listaAtualizada
  };
  return salvarDadosSeguro(arquivoRegistroLojas, dadosCompletos);
}

function calcularValoresDevidos(idLoja) {
  try {
    const camVendas = path.join(pastaLojas, idLoja, 'vendas');
    if (!fs.existsSync(camVendas)) return { total_vendas: 0, comissao: 0, taxa_entregadores: 0, total_devido: 0 };
    const arquivos = fs.readdirSync(camVendas).filter(a => a.endsWith('.json'));
    let totalVendas = 0, taxaEntregadores = 0;
    arquivos.forEach(arq => {
      try {
        const v = JSON.parse(fs.readFileSync(path.join(camVendas, arq), 'utf8'));
        if (!v.ja_fechado && v.origem === "ONLINE") {
          totalVendas += Number(v.valor_total || v.total || 0);
          taxaEntregadores += Number(v.taxa_entrega || v.valores?.entrega || 0);
        }
      } catch {}
    });
    const comissao = (totalVendas * PERCENTUAL_ADMIN) / 100;
    return { total_vendas: totalVendas, comissao, taxa_entregadores: taxaEntregadores, total_devido: comissao + taxaEntregadores };
  } catch {
    return { total_vendas: 0, comissao: 0, taxa_entregadores: 0, total_devido: 0 };
  }
}

function calcularAcertoSemanal(dataInicio = null, dataFim = null) {
  try {
    if (!fs.existsSync(pastaEntregas)) return { erro: "Pasta de entregas não encontrada" };
    const arquivos = fs.readdirSync(pastaEntregas).filter(a => a.endsWith('.json'));
    let total_vendas_produtos = 0, total_taxas_entrega = 0;
    const entregadoresMap = {};
    const hoje = new Date();
    if (!dataInicio || !dataFim) {
      const diaSemana = hoje.getDay();
      dataInicio = new Date(hoje);
      dataInicio.setDate(hoje.getDate() - diaSemana);
      dataInicio.setHours(0, 0, 0, 0);
      dataFim = new Date(dataInicio);
      dataFim.setDate(dataInicio.getDate() + 6);
      dataFim.setHours(23, 59, 59, 999);
    }
    arquivos.forEach(arq => {
      try {
        const entrega = JSON.parse(fs.readFileSync(path.join(pastaEntregas, arq), 'utf8'));
        const dataEntrega = new Date(entrega.data_hora);
        if (dataEntrega >= dataInicio && dataEntrega <= dataFim) {
          total_vendas_produtos += Number(entrega.valor_total || 0);
          total_taxas_entrega += Number(entrega.taxa_entrega || 0);
          const idEnt = entrega.id_entregador;
          if (idEnt) {
            if (!entregadoresMap[idEnt]) {
              entregadoresMap[idEnt] = {
                id_entregador: idEnt,
                nome: entrega.nome_entregador || 'Não informado',
                quantidade_entregas: 0,
                valor_receber: 0
              };
            }
            entregadoresMap[idEnt].quantidade_entregas++;
            entregadoresMap[idEnt].valor_receber += Number(entrega.taxa_entrega || 0);
          }
        }
      } catch {}
    });
    const comissaoAdmin = Number((total_vendas_produtos * PERCENTUAL_ADMIN / 100).toFixed(2));
    const listaEntregadores = Object.values(entregadoresMap).map(e => ({
      ...e,
      valor_receber: Number(e.valor_receber.toFixed(2))
    }));
    return {
      periodo: { inicio: dataInicio.toLocaleDateString('pt-BR'), fim: dataFim.toLocaleDateString('pt-BR') },
      total_vendas_produtos: Number(total_vendas_produtos.toFixed(2)),
      comissao_admin_5pct: comissaoAdmin,
      total_taxas_entrega: Number(total_taxas_entrega.toFixed(2)),
      detalhe_entregadores: listaEntregadores
    };
  } catch {
    return { erro: "Falha ao calcular acerto" };
  }
}

function verificarVencimentos() {
  try {
    const hoje = new Date();
    const lojas = carregarRegistroLojas();
    let alterou = false;
    lojas.forEach(loja => {
      if (!loja.pronta_para_exe) return;
      const ultimo = loja.ultimo_acerto ? new Date(loja.ultimo_acerto) : new Date(0);
      const vencimento = new Date(ultimo);
      vencimento.setDate(ultimo.getDate() + 7);
      const valores = calcularValoresDevidos(loja.id);
      if (loja.valor_devido !== valores.total_devido) {
        loja.valor_devido = valores.total_devido;
        alterou = true;
      }
      if (valores.total_devido === 0) {
        if (loja.status_sistema !== "ATIVO" || loja.aviso_enviado !== false) {
          loja.status_sistema = "ATIVO";
          loja.aviso_enviado = false;
          alterou = true;
        }
      } else {
        const umDiaAntes = new Date(vencimento);
        umDiaAntes.setDate(vencimento.getDate() - 1);
        if (hoje >= umDiaAntes && hoje < vencimento && !loja.aviso_enviado) {
          loja.status_sistema = "AVISO";
          loja.aviso_enviado = true;
          alterou = true;
        } else if (hoje >= vencimento && loja.status_sistema !== "BLOQUEADO") {
          loja.status_sistema = "BLOQUEADO";
          alterou = true;
        }
      }
      const camDadosLoja = path.join(pastaLojas, loja.id, 'dados_loja.json');
      if (fs.existsSync(camDadosLoja)) salvarDadosSeguro(camDadosLoja, loja);
    });
    if (alterou) salvarRegistroLojas(lojas);
  } catch (erro) {
    console.error("⚠️ Erro na verificação de vencimentos:", erro.message);
  }
}

setInterval(verificarVencimentos, 24 * 60 * 60 * 1000);
verificarVencimentos();

function verificarAdmin(req, res, next) {
  if (!PROTEGER_ROTAS) return next();
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${SENHA_ADMIN}`) return res.status(403).json({ sucesso: false, erro: "Acesso restrito" });
  next();
}

function rotaPagina(nomeBase, titulo) {
  return (req, res) => {
    const camHTML1 = path.resolve(pastaModelos, nomeBase + '.html');
    const camHTML2 = path.resolve(pastaModelos, nomeBase + '.htm');
    if (fs.existsSync(camHTML1)) return res.sendFile(camHTML1, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (fs.existsSync(camHTML2)) return res.sendFile(camHTML2, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    res.send(`<h2 style="color:red; text-align:center; margin-top:3rem;">❌ Página ${titulo} não encontrada.<br>Coloque o arquivo ${nomeBase}.html na pasta 'public' do projeto.</h2>`);
  };
}

// ======================================
// 📄 ROTAS DE PÁGINAS
// ======================================
app.get(`${BASE_URL}/`, rotaPagina('index', 'Painel Principal'));
app.get(`${BASE_URL}/cadastrar-lojas`, rotaPagina('cadastrar-lojas', 'Cadastrar Lojas'));
app.get(`${BASE_URL}/lojas-cadastradas`, rotaPagina('lojas-cadastradas', 'Lojas Cadastradas'));
app.get(`${BASE_URL}/gerenciar-entregadores`, rotaPagina('gerenciar-entregadores', 'Gerenciar Entregadores'));
app.get(`${BASE_URL}/entregador`, rotaPagina('entregador', 'Cadastro de Entregadores'));
app.get(`${BASE_URL}/entregador-area`, rotaPagina('pedidos', 'Área do Entregador'));
app.get(`${BASE_URL}/vendas-gerais`, rotaPagina('vendas-gerais', 'Vendas Gerais'));
app.get(`${BASE_URL}/prestacao-contas`, rotaPagina('prestacao-contas', 'Prestação de Contas'));
app.get(`${BASE_URL}/relatorios`, rotaPagina('relatorios', 'Relatórios'));
app.get(`${BASE_URL}/configuracoes`, rotaPagina('configuracoes', 'Configurações'));
app.get(`${BASE_URL}/pedidos`, rotaPagina('pedidos', 'Gerenciamento de Pedidos'));
app.get(`${BASE_URL}/entregas.html`, rotaPagina('entregas/entregas', 'Controle de Entregas'));
app.get(`${BASE_URL}/rede-lojas`, (req, res) => res.redirect(`${BASE_URL}/rede_de_lojas.html`));
app.get(`${BASE_URL}/encontrar-lojas`, rotaPagina('rede_de_lojas', 'Lista de Lojas'));

app.get(`${BASE_URL}/pdv/:idLoja`, (req, res) => {
  try {
    const idLoja = req.params.idLoja.trim();
    const loja = carregarRegistroLojas().find(l => l.id === idLoja);
    if (!loja) return res.send(`<h2 style="color:red; text-align:center;">❌ Loja não cadastrada</h2>`);
    const camBase = path.resolve(pastaModelos, 'pdv-base.html');
    if (!fs.existsSync(camBase)) return res.send(`<h2 style="color:red; text-align:center;">❌ Modelo PDV não encontrado — coloque pdv-base.html na pasta 'public'</h2>`);
    let conteudo = fs.readFileSync(camBase, 'utf8');
       // Substituir marcadores com dados da loja
    conteudo = conteudo.replace(/\{\{ID_LOJA\}\}/g, loja.id);
    conteudo = conteudo.replace(/\{\{NOME_LOJA\}\}/g, loja.nome || 'Loja');
    conteudo = conteudo.replace(/\{\{CNPJ_LOJA\}\}/g, loja.cnpj || '');
    conteudo = conteudo.replace(/\{\{COR_PRIMARIA\}\}/g, loja.cor_primaria || '#2563eb');
    conteudo = conteudo.replace(/\{\{COR_SECUNDARIA\}\}/g, loja.cor_secundaria || '#f3f4f6');
    conteudo = conteudo.replace(/\{\{TELEFONE_LOJA\}\}/g, loja.telefone || '');
    conteudo = conteudo.replace(/\{\{CIDADE_LOJA\}\}/g, loja.cidade || 'Campinas');
    conteudo = conteudo.replace(/\{\{ENDERECO_LOJA\}\}/g, loja.endereco || '');
    conteudo = conteudo.replace(/\{\{STATUS_SISTEMA\}\}/g, loja.status_sistema || 'ATIVO');
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(conteudo);
  } catch (erro) {
    console.error('❌ Erro ao carregar PDV:', erro.message);
    return res.status(500).send(`<h2 style="color:red; text-align:center;">⚠️ Erro ao carregar PDV</h2>`);
  }
});

// ======================================
// 🔌 API — LOJAS
// ======================================
app.get(`${BASE_URL}/api/lojas`, (req, res) => {
  try {
    const lojas = carregarRegistroLojas();
    res.json({ sucesso: true, dados: lojas });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.post(`${BASE_URL}/api/lojas`, verificarAdmin, (req, res) => {
  try {
    const { id, nome, cnpj, endereco, cidade, telefone, cor_primaria, cor_secundaria } = req.body;
    if (!id || !nome) return res.status(400).json({ sucesso: false, erro: 'ID e Nome são obrigatórios' });
    
    const lojas = carregarRegistroLojas();
    if (lojas.find(l => l.id === id)) return res.status(409).json({ sucesso: false, erro: 'Loja já cadastrada' });
    
    const novaLoja = {
      id, nome, cnpj, endereco, cidade, telefone,
      cor_primaria: cor_primaria || '#2563eb',
      cor_secundaria: cor_secundaria || '#f3f4f6',
      pronta_para_exe: true,
      status_sistema: 'ATIVO',
      aviso_enviado: false,
      ultimo_acerto: new Date().toISOString(),
      valor_devido: 0,
      data_cadastro: new Date().toISOString()
    };
    
    const pastaLoja = path.join(pastaLojas, id);
    if (!fs.existsSync(pastaLoja)) fs.mkdirSync(pastaLoja, { recursive: true });
    fs.mkdirSync(path.join(pastaLoja, 'vendas'), { recursive: true });
    
    salvarDadosSeguro(path.join(pastaLoja, 'dados_loja.json'), novaLoja);
    lojas.push(novaLoja);
    salvarRegistroLojas(lojas);
    
    fazerBackup();
    res.json({ sucesso: true, mensagem: 'Loja cadastrada', dados: novaLoja });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.put(`${BASE_URL}/api/lojas/:id`, verificarAdmin, (req, res) => {
  try {
    const { id } = req.params;
    let lojas = carregarRegistroLojas();
    const indice = lojas.findIndex(l => l.id === id);
    if (indice === -1) return res.status(404).json({ sucesso: false, erro: 'Loja não encontrada' });
    
    lojas[indice] = { ...lojas[indice], ...req.body, id };
    salvarRegistroLojas(lojas);
    salvarDadosSeguro(path.join(pastaLojas, id, 'dados_loja.json'), lojas[indice]);
    
    res.json({ sucesso: true, mensagem: 'Loja atualizada', dados: lojas[indice] });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.delete(`${BASE_URL}/api/lojas/:id`, verificarAdmin, (req, res) => {
  try {
    const { id } = req.params;
    let lojas = carregarRegistroLojas();
    const filtrado = lojas.filter(l => l.id !== id);
    if (filtrado.length === lojas.length) return res.status(404).json({ sucesso: false, erro: 'Loja não encontrada' });
    
    salvarRegistroLojas(filtrado);
    res.json({ sucesso: true, mensagem: 'Loja removida' });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.get(`${BASE_URL}/api/lojas/:id/valores`, (req, res) => {
  try {
    const valores = calcularValoresDevidos(req.params.id);
    res.json({ sucesso: true, dados: valores });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

// ======================================
// 🔌 API — ENTREGADORES
// ======================================
app.get(`${BASE_URL}/api/entregadores`, (req, res) => {
  try {
    res.json({ sucesso: true, dados: carregarEntregadores() });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.post(`${BASE_URL}/api/entregadores`, verificarAdmin, (req, res) => {
  try {
    const lista = carregarEntregadores();
    const novo = { id: Date.now().toString(), ...req.body, data_cadastro: new Date().toISOString() };
    lista.push(novo);
    salvarEntregadores(lista);
    res.json({ sucesso: true, dados: novo });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.put(`${BASE_URL}/api/entregadores/:id`, verificarAdmin, (req, res) => {
  try {
    let lista = carregarEntregadores();
    const indice = lista.findIndex(e => e.id === req.params.id);
    if (indice === -1) return res.status(404).json({ sucesso: false, erro: 'Não encontrado' });
    lista[indice] = { ...lista[indice], ...req.body };
    salvarEntregadores(lista);
    res.json({ sucesso: true, dados: lista[indice] });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.delete(`${BASE_URL}/api/entregadores/:id`, verificarAdmin, (req, res) => {
  try {
    let lista = carregarEntregadores();
    lista = lista.filter(e => e.id !== req.params.id);
    salvarEntregadores(lista);
    res.json({ sucesso: true, mensagem: 'Removido' });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

// ======================================
// 🔌 API — PRESTAÇÃO DE CONTAS
// ======================================
app.get(`${BASE_URL}/api/acerto-semanal`, (req, res) => {
  try {
    const { inicio, fim } = req.query;
    const dataInicio = inicio ? new Date(inicio) : null;
    const dataFim = fim ? new Date(fim) : null;
    const resultado = calcularAcertoSemanal(dataInicio, dataFim);
    if (resultado.erro) return res.status(400).json({ sucesso: false, erro: resultado.erro });
    res.json({ sucesso: true, dados: resultado });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

// ======================================
// 🔌 API — PEDIDOS / ENTREGAS
// ======================================
app.post(`${BASE_URL}/api/pedidos`, (req, res) => {
  try {
    const pedido = {
      id: Date.now().toString(),
      ...req.body,
      data_hora: new Date().toISOString(),
      status: 'recebido'
    };
    if (!fs.existsSync(pastaEntregas)) fs.mkdirSync(pastaEntregas, { recursive: true });
    salvarDadosSeguro(path.join(pastaEntregas, `pedido-${pedido.id}.json`), pedido);
    res.json({ sucesso: true, dados: pedido });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.get(`${BASE_URL}/api/pedidos`, (req, res) => {
  try {
    if (!fs.existsSync(pastaEntregas)) return res.json({ sucesso: true, dados: [] });
    const arquivos = fs.readdirSync(pastaEntregas).filter(a => a.endsWith('.json'));
    const pedidos = arquivos.map(a => {
      try { return JSON.parse(fs.readFileSync(path.join(pastaEntregas, a), 'utf8')); }
      catch { return null; }
    }).filter(Boolean);
    res.json({ sucesso: true, dados: pedidos });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

// ======================================
// 🔌 API — BACKUP
// ======================================
app.post(`${BASE_URL}/api/backup`, verificarAdmin, (req, res) => {
  try {
    fazerBackup();
    res.json({ sucesso: true, mensagem: 'Backup iniciado' });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

// ======================================
// 🚀 INICIAR SERVIDOR
// ======================================
app.listen(PORTA, () => {
  console.log(`\n✅ SERVIDOR RODANDO — Porta ${PORTA}`);
  console.log(`🌐 Acesso: ${ENDERECO_SERVIDOR}`);
  console.log(`📄 PDV exemplo: ${ENDERECO_SERVIDOR}/pdv/loja-teste`);
  console.log('========================================\n');
});

module.exports = app;