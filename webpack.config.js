import path from "path";
import CopyPlugin from "copy-webpack-plugin";
import HtmlMinimizerPlugin from "html-minimizer-webpack-plugin";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  entry: {
    background: "./src/background.ts",
    result: "./src/result.ts",
  },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: "ts-loader",
          options: {
            transpileOnly: true,
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "src/manifest.json", to: "manifest.json" },
        {
          from: "src/result.html",
          to: "result.html",
          /** Mark as minimizable so HtmlMinimizerPlugin picks it up. */
          info: { minimized: false },
        },
        { from: "assets/shakespeare-icon.png", to: "icons/shakespeare-icon.png" },
      ],
    }),
  ],
  optimization: {
    minimize: true,
    minimizer: [
      "...",
      new HtmlMinimizerPlugin({
        minimizerOptions: {
          collapseWhitespace: true,
          removeComments: true,
          minifyCSS: true,
          removeRedundantAttributes: true,
          removeEmptyAttributes: true,
          removeOptionalTags: true,
        },
      }),
    ],
  },
  performance: {
    hints: false,
  },
};
