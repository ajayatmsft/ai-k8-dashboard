'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { validName, validSelector, nsArgs, badRequest, forbidden, compileRegex } = require('../src/util');

test('validName accepts k8s resource names', () => {
  assert.ok(validName('nginx'));
  assert.ok(validName('my-app-123'));
  assert.ok(validName('a'));
  assert.ok(validName('web.v2'));
});

test('validName rejects injection attempts and invalid names', () => {
  assert.ok(!validName(''));
  assert.ok(!validName('-leading-dash'));
  assert.ok(!validName('trailing-'));
  assert.ok(!validName('has space'));
  assert.ok(!validName('semi;colon'));
  assert.ok(!validName('$(rm -rf /)'));
  assert.ok(!validName('a'.repeat(254)));
  assert.ok(!validName(null));
  assert.ok(!validName(123));
});

test('validSelector accepts label selectors, rejects shell metacharacters', () => {
  assert.ok(validSelector('app=foo'));
  assert.ok(validSelector('app=foo,tier in (a,b)'));
  assert.ok(validSelector('app!=bar'));
  assert.ok(validSelector(''));
  assert.ok(!validSelector('app=foo;rm -rf'));
  assert.ok(!validSelector('a'.repeat(513)));
  assert.ok(!validSelector('$(x)'));
});

test('nsArgs maps namespace to kubectl flags', () => {
  assert.deepStrictEqual(nsArgs('_all'), ['--all-namespaces']);
  assert.deepStrictEqual(nsArgs(''), ['--all-namespaces']);
  assert.deepStrictEqual(nsArgs(undefined), ['--all-namespaces']);
  assert.deepStrictEqual(nsArgs('default'), ['-n', 'default']);
});

test('error helpers carry HTTP status', () => {
  assert.strictEqual(badRequest('x').status, 400);
  assert.strictEqual(forbidden('x').status, 403);
});

test('compileRegex returns case-insensitive regex or throws 400', () => {
  assert.strictEqual(compileRegex(''), null);
  assert.ok(compileRegex('ext').test('EXTENSION-pod'));
  assert.throws(() => compileRegex('(unclosed'), (e) => e.status === 400);
});
