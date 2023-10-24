const webpack = require('webpack');
const path = require('path');

module.exports = {
	mode       : 'production',
	entry      : {
		main: './src/client/index.ts',
	},
	output     : {
		path         : path.resolve(__dirname, './dist/browser'),
		filename     : 'index.js',
		libraryTarget: 'commonjs'
	},
	resolve    : {
		extensions: ['.ts', '.js'],
	},
	module     : {
		rules: [
			{
				test  : /\.ts$/,
				loader: 'ts-loader'
			}
		]
	},
	plugins    : [],
	performance: {
		maxEntrypointSize: 700000,
		maxAssetSize     : 700000
	},
};
