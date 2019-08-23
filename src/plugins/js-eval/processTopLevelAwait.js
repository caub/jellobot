const babelParser = require('@babel/parser');
const babelGenerator = require('@babel/generator').default;
const babelTraverse = require('@babel/traverse').default;
const { parserPlugins } = require('./babelPlugins');

/**
 * 
 * @param {string} src 
 * @return {string}
 */
function processTopLevelAwait(src) {
  let root;

  try {
    root = babelParser.parse(src, {
      allowAwaitOutsideFunction: true,
      plugins: parserPlugins
    });
  } catch (error) {
    return null; // if code is not valid, don't bother
  }

  let containsAwait = false;
  let containsReturn = false;

  babelTraverse(root, {
    enter(path) {
      switch (path.type) {
        case 'FunctionDeclaration':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
        case 'MethodDefinition':
        case 'ClassMethod':
          // stop when entering a new function scope:
          return path.stop();

        case 'ForOfStatement':
          if (path.node.await === true) {
            containsAwait = true;
          }
          return;

        case 'AwaitExpression':
          containsAwait = true;
          return;

        case 'ReturnStatement':
          containsReturn = true;
          return;
      }
    }
  });

  // Do not transform if
  // 1. False alarm: there isn't actually an await expression.
  // 2. There is a top-level return, which is not allowed.
  if (!containsAwait || containsReturn) {
    return null;
  }

  let last = root.program.body[root.program.body.length - 1];
  if (last.type === 'ExpressionStatement') {
    last = last.expression;
  }

  // replace last node with a returnStatement of this node
  root.program.body[root.program.body.length - 1] = {
    type: 'ReturnStatement',
    argument: last
  };

  const iiafe = {
    type: 'CallExpression',
    callee: {
      type: 'ArrowFunctionExpression',
      async: true,
      params: [],
      body: {
        type: 'BlockStatement',
        body: root.program.body
      },
    },
    arguments: []
  };
  // const iiafe = t.callExpression(t.arrowFunctionExpression([], t.blockStatement(root.program.body)), []) // with @babel/types

  return babelGenerator(iiafe).code;
}

module.exports = processTopLevelAwait;
