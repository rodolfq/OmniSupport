const { Client } = require('pg');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

// Mesmo formato de hash usado por lib/auth-utils.ts (hashPassword) e pela
// criação real de usuário em app/actions.ts (createUser) — senha padrão
// 'Mudar@123', must_change_password fica TRUE (default da coluna), então
// cada um troca no primeiro login.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 10000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

const csv = `Alessandro Vidal;alessandro.vidal@systemsat.com.br
Aline Gama;aline.gama@systemsat.com.br
Ana Carolina Modesto;anacarolina.modesto@systemsat.com.br
Ana Julia;ana.julia@systemsat.com.br
Antonio Loureiro;antonio.loureiro@systemsat.com.br
Bernard Galdino;bernard.galdino@systemsat.com.br
Bernardo Fogaça;bernardo.fogaca@systemsat.com.br
Bianca Miceli;bianca.miceli@systemsat.com.br
Bianca de Oliveira;bianca.oliveira@systemsat.com.br
Brenno Baldino;brenno.baldino@systemsat.com.br
Bruno Alonso;bruno.alonso@systemsat.com.br
Bruno Costa;bruno.costa@systemsat.com.br
Bruno Rodrigues;bruno.rodrigues@systemsat.com.br
Carlos Braga;carlos.braga@systemsat.com.br
Carlos Magno;carlos.magno@systemsat.com.br
Clarisse Pereira;clarice.pereira@systemsat.com.br
Dagoberto Guerrieri;dagoberto.guerrieri@systemsat.com.br
Daniel Galdino;daniel.galdino@systemsat.com.br
Daniel Loredo;loredo@ssatcorretora.com.br
Davidson Cunha;davidson.cunha@systemsat.com.br
Denis - Safetrack;denis@safetrack.com.br
Diego Moura;diego.moura@systemsat.com.br
Diogo Ferreira;diogo.ferreira@systemsat.com.br
Eduarda Melo;eduarda.melo@systemsat.com.br
Ericson da Silva;ericson.silva@systemsat.com.br
Evilyn Azevedo;evilyn.azevedo@systemsat.com.br
Fabio Vasconcelos;fabio.vasconcelos@systemsat.com.br
Felipe Laurentino;felipe.laurentino@systemsat.com.br
Fernanda Miranda;fernanda.miranda@systemsat.com.br
Francisco Silva;francisco.silva@systemsat.com.br
Gabriel Cintra;gabriel.cintra@systemsat.com.br
Gabriel Froes;gabriel.froes@systemsat.com.br
Gustavo de Carvalho Castro;gustavo.carvalho@systemsat.com.br
Heitor Nunes;heitor.nunes@systemsat.com.br
Italo Silva;italo.silva@iotservice.com.br
Ivan Junior;ivan.faria@systemsat.com.br
Jean Ricardo;jean.ricardo@systemsat.com.br
Jeferson Augusto;jeferson.augusto@systemsat.com.br
Jeff Borges;jeff.borges@systemsat.com.br
Jonathan Paladino;jonathan.paladino@systemsat.com.br
Jonathas Menezes;jonathas.menezes@systemsat.com.br
José Almeida;jose.almeida@systemsat.com.br
João Pedro Oliveira Sotelino de Paula;joao.pedro@systemsat.com.br
Juan Candia;juan.candia@systemsat.com.br
Karen de Oliveira Carvalho;karen.oliveira@systemsat.com.br
Kárita Guarani;karita.guarani@systemsat.com.br
Leandro Vargas;leandro.vargas@systemsat.com.br
Leonardo Araújo;leonardo.araujo@systemsat.com.br
Leonardo Lemos;leonardo.lemos@systemsat.com.br
Leonardo Martinez;leonardo.martinez@systemsat.com.br
Lucas Barreto de Azevedo Almeida;lucas.barreto@systemsat.com.br
Lucas Maestrelli;lucas.maestrelli@systemsat.com.br
Lucas Ribeiro;lucas.ribeiro@systemsat.com.br
Luiz Felipe;luiz.felipe@systemsat.com.br
MOVA;suporte@movaomundo.com
Marcos Vieira;marcos.vieira@systemsat.com.br
Mariane Teixeira;mariane.teixeira@systemsat.com.br
Mauro Paula;mauro.paula@systemsat.com.br
Mychelle Sarlo;mychelle.sarlo@systemsat.com.br
Natália Teixeira;natalia.teixeira@systemsat.com.br
Pablo Alves;pablo.alves@systemsat.com.br
Patricia Escaño;patricia.escano@systemsat.com.br
Patricia Fernandes;patricia.fernandes@systemsat.com.br
Paulo Souza;suporte@terrasatonline.com
Paulo Stevo Gomes;paulo.stevo@systemsat.com.br
Pedro Czertok;pedro.czertok@systemsat.com.br
Pedro Henrique;pedro.henrique@systemsat.com.br
Pedro Machado;pedro.machado@systemsat.com.br
Pedro Soares;pedro.soares@systemsat.com.br
Rafael Ferreira Leal;rafael.leal@systemsat.com.br
Rafael Santos;rafael.santos@systemsat.com.br
Rafaela Agnelo;rafaela.agnelo@systemsat.com.br
Raphael Prudente;raphael.prudente@systemsat.com.br
Rayane Costa;rayane.costa@systemsat.com.br
Renato Tardin;renato.tardin@systemsat.com.br
Rodolfo Quintanilha;rodolfo.quintanilha@systemsat.com.br
Ruane Barbosa Ruiz de Carvalho;ruane.barbosa@systemsat.com.br
Rubens Neto;rubens.neto@systemsat.com.br
Sandro Massarani;sandro.massarani@systemsat.com.br
Tabata Faria;tabata.faria@systemsat.com.br
Thayna Silva;thayna.silva@systemsat.com.br
Thiago Kalahy;thiago.silva@systemsat.com.br
Thierri Silva;thierri.silva@systemsat.com.br
Victor Pochettini Costa de Queiroz;victor.costa@systemsat.com.br
Vinicius Saraiva;vinicius.saraiva@systemsat.com.br
Vitor Souza;vitor.souza@systemsat.com.br
Willian Batista;willian.batista@systemsat.com.br
Yago Vanzan;yago.vanzan@systemsat.com.br
andrey.czertok;andrey.czertok@systemsat.com.br
joao.lucas;joao.lucas@systemsat.com.br
pedro.rangel@systemsat.com.br;pedro.rangel@systemsat.com.br`;

async function run() {
  const rows = csv.trim().split('\n').map(line => {
    const [name, email] = line.split(';').map(s => s.trim());
    return { name, email: email.toLowerCase() };
  });

  // Dedupe dentro do próprio CSV (mantém a primeira ocorrência)
  const seen = new Set();
  const deduped = [];
  const csvDuplicates = [];
  for (const r of rows) {
    if (seen.has(r.email)) { csvDuplicates.push(r.email); continue; }
    seen.add(r.email);
    deduped.push(r);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const existingRes = await client.query('SELECT lower(email) AS email FROM public.profiles WHERE lower(email) = ANY($1)', [deduped.map(r => r.email)]);
    const existingEmails = new Set(existingRes.rows.map(r => r.email));

    const toInsert = deduped.filter(r => !existingEmails.has(r.email));
    const skippedExisting = deduped.filter(r => existingEmails.has(r.email));

    let inserted = 0;
    for (const r of toInsert) {
      const passwordHash = hashPassword('Mudar@123');
      const res = await client.query(
        `INSERT INTO public.profiles (email, name, role, password, must_change_password, lives_in_squad, is_admin)
         VALUES ($1, $2, 'Equipe', $3, TRUE, TRUE, FALSE)
         ON CONFLICT (email) DO NOTHING
         RETURNING email`,
        [r.email, r.name, passwordHash]
      );
      if (res.rowCount > 0) inserted++;
    }

    console.log(`Total no CSV: ${rows.length}`);
    console.log(`Duplicados dentro do CSV (ignorados): ${csvDuplicates.length}`, csvDuplicates);
    console.log(`Já existiam no banco (ignorados): ${skippedExisting.length}`, skippedExisting.map(r => r.email));
    console.log(`Inseridos com sucesso: ${inserted}`);
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('ERRO na importação:', err);
  process.exit(1);
});
