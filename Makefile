.PHONY: all build dev format format-check lint test test-watch test-mcp help

all: help

build:
	npm run build

dev:
	npm run dev

format:
	npm run format

format-check:
	npm run format:check

lint:
	npm run lint

test:
	npm test

test-watch:
	npm run test:watch

test-mcp:
	npm run test:mcp -- $(ARGS)

help:
	@echo 'build         - compile TypeScript into dist/'
	@echo 'dev           - run the MCP server from TypeScript source'
	@echo 'format        - format the repository with Prettier'
	@echo 'format-check  - check formatting without modifying files'
	@echo 'lint          - type-check TypeScript'
	@echo 'test          - run unit and MCP integration tests'
	@echo 'test-watch    - run tests in watch mode'
	@echo 'test-mcp      - smoke-test a running HTTP server; pass ARGS="..."'
