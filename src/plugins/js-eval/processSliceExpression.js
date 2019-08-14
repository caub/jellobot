const { Parser, tokTypes: tt } = require('acorn');
const walk = require('acorn-walk');
const recast = require('recast');

/*
Limitation:

MemberExpression [ SliceExpression ] is transformed into something like:
MemberExpression.object.slice ( SliceExpression.startIndex, SliceExpression.endIndex)
So it won't use SliceExpression.step, and will only work with an instance of Array or String
which have `slice` in their prototype, not an ArrayLike object

*/

function parseSliceExpressionPlugin(Parser) {
  return class extends Parser {
    // Parse a slice (`start:end:step`) operator or a conditional (`cond ? a : b`) operator
    parseMaybeConditional(noIn, refDestructuringErrors) {
      let startPos = this.start, startLoc = this.startLoc
      let startIndex, endIndex, step; // can't name them 'start', 'end' because those are Parser properties
      if (!this.eat(tt.colon)) {
        startIndex = super.parseMaybeConditional(noIn, refDestructuringErrors);

        if (this.type !== tt.colon) return startIndex; // not a SliceExpression, return the parsed expression

        this.eat(tt.colon);
      }

      //now we're sure to be in a slice operator, we've already parsed (start):

      let hasSecondColon = this.eat(tt.colon);

      if (!hasSecondColon && this.type !== tt.bracketR) {
        endIndex = super.parseMaybeConditional(noIn, refDestructuringErrors);

        hasSecondColon = this.eat(tt.colon);
      }

      // we're after end, (start):(end)(:(step)) and parse a possible step expression
      //                                 ^

      if (hasSecondColon && this.type !== tt.bracketR) {
        step = super.parseMaybeConditional(noIn, refDestructuringErrors);
      }

      let node = this.startNodeAt(startPos, startLoc)
      node.startIndex = startIndex;
      node.endIndex = endIndex;
      node.step = step;
      return this.finishNode(node, "SliceExpression")
    }
  }
}

const ParserWithSE = Parser.extend(
  parseSliceExpressionPlugin
)

const base = {};

for (const [type, fn] of Object.entries(walk.base)) {
  base[type] = (node, ancestors, c) => {
    fn(node, ancestors[0] === node ? [...ancestors] : [node, ...ancestors], c);
  };
}

function replaceNode(parent, node, newNode) {
  // locate node
  let target, key;
  for (const [k, v] of Object.entries(parent)) {
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v) && v.includes(node)) {
      target = v;
      key = v.indexOf(node);
      break;
    } else if (!Array.isArray(v) && v === node) {
      target = parent;
      key = k;
      break;
    }
  }
  target[key] = newNode;
}

module.exports = function processSliceExpression(source) {
  const root = ParserWithSE.parse(source);

  walk.recursive(root, [], {
    MemberExpression: (node, ancestors, c) => {
      if (node.property.type !== 'SliceExpression') {
        return base.MemberExpression(node, ancestors, c);
      }

      const {
        startIndex = { type: 'Identifier', name: 'undefined' },
        endIndex = { type: 'Identifier', name: 'undefined' },
      } = node.property;

      const expr = {
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: node.object,
          property: { type: 'Identifier', name: 'slice' }
        },
        arguments: [startIndex, endIndex]
      }

      replaceNode(ancestors[1], node, expr);
    },

    SliceExpression: (node, ancestors, c) => {
      const {
        startIndex = { type: 'Identifier', name: 'undefined' },
        endIndex = { type: 'Identifier', name: 'undefined' },
        step = { type: 'Literal', value: 1 },
      } = node;

      const expr = {
        type: 'CallExpression',
        callee: {
          type: 'FunctionExpression',
          generator: true,
          params: [
            { type: 'Identifier', name: 'si' },
            { type: 'Identifier', name: 'ei' },
            { type: 'Identifier', name: 'step' },
          ],
          body: {
            type: 'BlockStatement',
            body: [{
              type: 'IfStatement',
              test: {
                type: 'BinaryExpression',
                left: { type: 'Identifier', name: 'step' },
                operator: '<',
                right: { type: 'Literal', value: 0 },
              },
              consequent: {
                type: 'BlockStatement',
                body: [{
                  type: 'ForStatement',
                  init: {
                    type: 'VariableDeclaration',
                    declarations: [{
                      type: 'VariableDeclarator',
                      id: { type: 'Identifier', name: 'i' },
                      init: {
                        type: 'BinaryExpression',
                        left: { type: 'Identifier', name: 'ei' },
                        operator: '+',
                        right: { type: 'Identifier', name: 'step' },
                      }
                    }],
                    kind: 'let'
                  },
                  test: {
                    type: 'BinaryExpression',
                    left: { type: 'Identifier', name: 'i' },
                    operator: '>=',
                    right: { type: 'Identifier', name: 'si' },
                  },
                  update: {
                    type: 'AssignmentExpression',
                    left: { type: 'Identifier', name: 'i' },
                    operator: '+=',
                    right: { type: 'Identifier', name: 'step' },
                  },
                  body: {
                    type: 'ExpressionStatement',
                    expression: {
                      type: 'YieldExpression',
                      argument: { type: 'Identifier', name: 'i' }
                    }
                  }
                }]
              },
              alternate: {
                type: 'BlockStatement',
                body: [{
                  type: 'ForStatement',
                  init: {
                    type: 'VariableDeclaration',
                    declarations: [{
                      type: 'VariableDeclarator',
                      id: { type: 'Identifier', name: 'i' },
                      init: { type: 'Identifier', name: 'si' }
                    }],
                    kind: 'let'
                  },
                  test: {
                    type: 'BinaryExpression',
                    left: { type: 'Identifier', name: 'i' },
                    operator: '<',
                    right: { type: 'Identifier', name: 'ei' },
                  },
                  update: {
                    type: 'AssignmentExpression',
                    left: { type: 'Identifier', name: 'i' },
                    operator: '+=',
                    right: { type: 'Identifier', name: 'step' },
                  },
                  body: {
                    type: 'ExpressionStatement',
                    expression: {
                      type: 'YieldExpression',
                      argument: { type: 'Identifier', name: 'i' }
                    }
                  }
                }]
              }
            }]
          }
        },
        arguments: [startIndex, endIndex, step]
      };

      replaceNode(ancestors[1], node, expr);
    }
  }, base);

  return recast.print(root).code;
}
