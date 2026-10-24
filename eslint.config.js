// Lint cho mã của app (T-0911). Chỉ bắt lỗi thật (biến chưa khai báo, biến thừa, mã không chạy tới),
// không ép kiểu viết; luật lấy từ bộ "recommended" của ESLint.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'bin/**', 'dist/**', '.claude/**'],
  },
  js.configs.recommended,
  {
    // Máy chủ, Electron, thư viện, script và test: CommonJS chạy trong Node.
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // Mã chạy trong trang web của giao diện.
    files: ['public/js/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser },
    },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
];
