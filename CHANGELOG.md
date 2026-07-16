# Changelog

All notable changes to Streamarr and Playarr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Require completed changes to be committed and pushed promptly as small, atomic Conventional
  Commits, with a changelog entry and validation in the same commit.

### Security

- Ignore local runtime data, browser-automation helpers, embedding caches, and the local backend
  scratch runner so credentials, databases, downloaded models, and machine-specific paths cannot
  be committed accidentally.
