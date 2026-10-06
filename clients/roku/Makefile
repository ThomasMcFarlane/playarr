BRS_TESTS := python3 tests/brs/run_brs_tests.py

.PHONY: validate lint test brs-test compile package deploy clean

BUILD_DIR := build
PACKAGE := $(BUILD_DIR)/playarr-roku.zip

validate: lint test

lint:
	python3 scripts/validate.py

test:
	python3 -m unittest discover -s tests -p 'test_*.py'

# Compile-checks every BrightScript file with BrighterScript (syntax, undefined
# functions, wrong argument counts). Needs Node; no Roku device or SDK.
# BrightScript logic tests in the Linux simulation engine (needs Node; see tests/brs).
brs-test:
	$(BRS_TESTS)

compile:
	npx --yes brighterscript@0.73.5 --project bsconfig.json --noEmit

package: validate
	./scripts/package.sh "$(PACKAGE)"

deploy: package
	./scripts/deploy.sh "$(PACKAGE)"

clean:
	rm -f "$(PACKAGE)"
