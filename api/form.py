"""Minimal form validation utilities extracted for UDF API."""

import re
import functools
from flask import request

__all__ = ['F_str', 'F_int', 'form_validator']

fstr_default_max = 1024 * 512

_default_messages = {
    'max': '%(name)s 的最大值为%(max)s',
    'min': '%(name)s 最小值为%(min)s',
    'max_len': '%(name)s 最大长度为%(max_len)s个字符',
    'min_len': '%(name)s 最小长度为%(min_len)s个字符',
    'blank': '%(name)s 不能为空',
    'format': '%(name)s 格式不正确',
    'default': '%(name)s 格式不正确',
}


class FormError(Exception):
    pass


class FormChecker:
    def __init__(self, source, input_form, method='both'):
        self._source = source
        self._form = input_form
        self._checked = False
        self._method = method

    def check(self, source=None):
        if source is None:
            if hasattr(self._source, 'get'):
                source = self._source
            else:
                source = self._source

        form = self._form
        valid_data, raw_data, messages = {}, {}, {}
        self._valid = True

        for field, checker in form.items():
            value = source.get(field, None)
            valid, raw_data[field], v, m = checker.check(field, value)
            if valid:
                valid_data[field] = v
            else:
                messages[field] = m
            self._valid = self._valid and valid

        self._raw_data = raw_data
        self._valid_data = valid_data
        self._messages = messages
        self._checked = True

        for field in list(self._messages.keys()):
            if not self._messages[field]:
                self._messages.pop(field)

    def is_valid(self):
        if not self._checked:
            self.check()
        return self._valid

    def get_error_messages(self):
        if not self._checked:
            self.check()
        return self._messages

    def get_valid_data(self):
        if not self._checked:
            self.check()
        return self._valid_data


def form_validator(form_items, post_only=False, strict_fields=None):
    def new_deco(old_handler):
        @functools.wraps(old_handler)
        def new_handler(*args, **kwargs):
            settings = dict(form_items)
            req_data = {}
            if request.is_json and request.get_data() and request.method in ('POST', 'PUT', 'PATCH'):
                data = request.get_json(silent=True) or {}
                for name in settings:
                    req_data[name] = data.get(name)
            else:
                for name in settings:
                    req_data[name] = request.values.get(name)

            checker = FormChecker(req_data, settings)
            if not checker.is_valid():
                errors = checker.get_error_messages()
                field, message = next(iter(errors.items()), (None, None))
                if (not post_only) or request.method == 'POST' or strict_fields:
                    raise FormError(f"{field}: {message}")

            kwargs['vars'] = checker.get_valid_data()
            return old_handler(*args, **kwargs)
        return new_handler
    return new_deco


class Input:
    _type = None
    _min = None
    _max = None
    _optional = False
    _strict = False
    _attrs = ('optional', 'required', 'strict')
    _callbacks = (lambda v: (True, v),)
    _default_value = None
    _message_key = None

    def __init__(self, field_name=None, default_value=None):
        self._name = field_name
        self._messages = {}
        self._messages.update(_default_messages)
        self._message_vars = {'name': field_name}
        if default_value is not None:
            self._default_value = default_value

    def check_value(self, raw):
        valid = False
        valid_data = None
        message = None
        value = raw

        if self._strict and value is not None and isinstance(value, str) and value.strip() == '':
            value = None

        if value is None and self._default_value is not None:
            value = self._default_value

        if value is not None and value != '':
            valid, data = self._check(value)
            if valid:
                valid, data = self._callbacks[0](data)
                if valid:
                    valid_data = data
                else:
                    message = self._messages.get('default', '')
            else:
                message = data
        elif self._optional:
            valid = True
            valid_data = value
        else:
            message = self._messages['blank']

        message_vars = dict(self._message_vars)
        if message:
            message = message % message_vars

        return valid, raw, valid_data, message

    def check(self, name, value):
        if self._message_vars['name'] is None:
            self._message_vars['name'] = name
        return self.check_value(value)

    def __and__(self, setting):
        if callable(setting):
            self._callbacks = (setting,)
        elif isinstance(setting, dict):
            self._messages.update(setting)
        elif setting in self._attrs:
            value = True
            if setting == 'required':
                setting = 'optional'
                value = False
            attr = '_%s' % setting
            if hasattr(self, attr):
                setattr(self, attr, value)
        else:
            raise NameError('%s is not support' % setting)
        return self

    def __le__(self, max_value):
        self._max = max_value
        self._message_vars['max'] = max_value
        self._message_vars['max_len'] = max_value
        return self

    def __ge__(self, min_value):
        self._min = min_value
        self._message_vars['min'] = min_value
        self._message_vars['min_len'] = min_value
        return self

    def _check_mm(self, value):
        if self._max is not None and value > self._max:
            self._message_key = 'max'
            return False
        if self._min is not None and value < self._min:
            self._message_key = 'min'
            return False
        return True


class F_int(Input):
    _strict = True

    def __init__(self, field_name=None, default_value=None, choices=None, **kwargs):
        super().__init__(field_name, default_value)
        self._choices = choices

    def _check(self, value):
        try:
            value = int(value)
        except (ValueError, TypeError):
            return False, self._messages['default']
        if not self._check_mm(value):
            return False, self._messages[self._message_key]
        if self._choices:
            choice = getattr(self._choices, 'ALL', [])
            if callable(choice):
                choice = choice()
            if choice and value not in choice:
                return False, self._messages.get('default')
        return True, value


class F_str(Input):
    def __init__(self, field_name=None, default_value=None, choices=None,
                 max_len=fstr_default_max, **kwargs):
        super().__init__(field_name, default_value)
        self._strip = True
        self._choices = choices
        self._max = max_len
        self._message_vars['max'] = max_len
        self._message_vars['max_len'] = max_len

    def _check(self, value):
        if self._strip:
            value = value.strip()
        if not self._check_mm(len(value)):
            return False, self._messages[self._message_key + '_len']
        if self._choices:
            if self._optional and value and value not in self._choices:
                return False, self._messages.get('default') % self._message_vars
            if not self._optional and value not in self._choices:
                return False, self._messages.get('default') % self._message_vars
        return True, value
