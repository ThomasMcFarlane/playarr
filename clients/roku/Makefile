.PHONY: validate lint test package deploy clean

BUILD_DIR := build
PACKAGE := $(BUILD_DIR)/playarr-roku.zip

validate: lint test

lint:
	python3 scripts/validate.py

test:
	python3 -m unittest discover -s tests -p 'test_*.py'

package: validate
	./scripts/package.sh "$(PACKAGE)"

deploy: package
	./scripts/deploy.sh "$(PACKAGE)"

clean:
	rm -f "$(PACKAGE)"
