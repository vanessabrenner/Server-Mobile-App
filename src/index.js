const Koa = require('koa');
const app = new Koa();
const server = require('http').createServer(app.callback());
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server });
const Router = require('koa-router');
const cors = require('koa-cors');
const bodyparser = require('koa-bodyparser');

// Middleware pentru parsarea corpului cererii și CORS
app.use(bodyparser());
app.use(cors());

// Middleware pentru logarea cererilor
app.use(async (ctx, next) => {
  const start = new Date();
  await next();
  const ms = new Date() - start;
  console.log(`${ctx.method} ${ctx.url} ${ctx.response.status} - ${ms}ms`);
});

// Simulare de întârziere pentru răspunsuri
app.use(async (ctx, next) => {
  await new Promise(resolve => setTimeout(resolve, 2000));
  await next();
});

// Middleware pentru gestionarea erorilor
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.response.body = { message: err.message || 'Unexpected error' };
    ctx.response.status = 500;
  }
});

// Clasa Book
class Book {
  constructor({ id, title, author, pages, date, version, inStock = true }) {
    this.id = id;
    this.title = title;
    this.author = author;
    this.pages = pages;
    this.date = date;
    this.version = version;
    this.inStock = inStock; // Stocul cărții
  }
}

// Datele inițiale
const books = [
  new Book({ id: '1', title: 'To Kill a Mockingbird', author: 'Harper Lee', pages: 281, date: new Date('1960-07-11'), version: 1, inStock: true }),
  new Book({ id: '2', title: '1984', author: 'George Orwell', pages: 328, date: new Date('1949-06-08'), version: 1, inStock: true }),
  new Book({ id: '3', title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', pages: 180, date: new Date('1925-04-10'), version: 1, inStock: true }),
];

let lastUpdated = books[books.length - 1].date;
let lastId = books[books.length - 1].id;

// Funcție de broadcast pentru WebSocket
const broadcast = (data) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
};

// Crearea rutei
const router = new Router();

// Ruta pentru obținerea tuturor cărților
router.get('/book', (ctx) => {
  ctx.response.body = books;
  ctx.response.status = 200; // OK
});

// Ruta pentru obținerea unei cărți după ID
router.get('/book/:id', (ctx) => {
  const bookId = ctx.params.id;
  const book = books.find((b) => b.id === bookId);
  if (book) {
    ctx.response.body = book;
    ctx.response.status = 200; // OK
  } else {
    ctx.response.body = { message: `Book with id ${bookId} not found` };
    ctx.response.status = 404; // NOT FOUND
  }
});

// Funcția de creare a unei cărți
const createBook = async (ctx) => {
  const bookData = ctx.request.body;
  if (!bookData.title || !bookData.author || !bookData.pages) { // Validare
    ctx.response.body = { message: 'Title, author, and pages are required' };
    ctx.response.status = 400; // BAD REQUEST
    return;
  }
  const newBook = new Book({
    id: `${parseInt(lastId) + 1}`,
    title: bookData.title,
    author: bookData.author,
    pages: bookData.pages,
    date: new Date(),
    version: 1,
    inStock: bookData.inStock !== undefined ? bookData.inStock : true // Asigură că se păstrează stocul
  });
  lastId = newBook.id;
  books.push(newBook);
  ctx.response.body = newBook;
  ctx.response.status = 201; // CREATED
  broadcast({ event: 'created', payload: { book: newBook } });
};

// Ruta pentru crearea unei cărți
router.post('/book', async (ctx) => {
  await createBook(ctx);
});

// Ruta pentru actualizarea unei cărți
router.put('/book/:id', async (ctx) => {
  const id = ctx.params.id;
  const bookData = ctx.request.body;
  const index = books.findIndex(b => b.id === id);

  if (index === -1) {
    ctx.response.body = { message: `Book with id ${id} not found` };
    ctx.response.status = 404; // NOT FOUND
    return;
  }

  const currentBook = books[index];

  // Verificare conflict de versiune
  const bookVersion = parseInt(ctx.request.get('ETag')) || bookData.version;
  if (bookVersion < currentBook.version) {
    ctx.response.body = { message: `Version conflict` };
    ctx.response.status = 409; // CONFLICT
    return;
  }

  // Actualizare date
  const updatedBook = {
    ...currentBook,
    ...bookData,
    date: new Date(),
    version: currentBook.version + 1,
  };
  books[index] = updatedBook;

  ctx.response.body = updatedBook;
  ctx.response.status = 200; // OK
  broadcast({ event: 'updated', payload: { book: updatedBook } });
});

// Ruta pentru ștergerea unei cărți
router.delete('/book/:id', async (ctx) => {
  const id = ctx.params.id;
  const index = books.findIndex(b => b.id === id);

  if (index === -1) {
    ctx.response.body = { message: `Book with id ${id} not found` };
    ctx.response.status = 404; // NOT FOUND
    return;
  }

  const deletedBook = books[index];
  books.splice(index, 1);
  ctx.response.status = 204; // NO CONTENT
  broadcast({ event: 'deleted', payload: { book: deletedBook } });
});

// Generarea de cărți noi la fiecare 5 secunde
setInterval(() => {
  lastUpdated = new Date();
  lastId = `${parseInt(lastId) + 1}`;
  const newBook = new Book({
    id: lastId,
    title: `Book ${lastId}`,
    author: `Author ${lastId}`,
    pages: 100 + parseInt(lastId) * 50,
    date: lastUpdated,
    version: 1,
    inStock: true // Setăm inStock la true pentru cărțile noi
  });
  books.push(newBook);
  console.log(`New book: ${newBook.title}`);
  broadcast({ event: 'created', payload: { book: newBook } });
}, 5000);

// Activarea rutelor
app.use(router.routes());
app.use(router.allowedMethods());

// Pornirea serverului pe portul 3000
server.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
});
